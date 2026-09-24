package com.weav.workflow.infrastructure.http;

import com.weav.workflow.application.node.NodeExecutor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Validates and resolves a user supplied HTTP destination immediately before
 * an outbound call. The returned addresses are installed in the transport's
 * resolver so the socket uses the addresses that were checked here.
 */
@Component
public final class OutboundTargetPolicy {

    private static final int MAX_URI_LENGTH = 8 * 1024;
    private static final Set<String> METADATA_HOSTS = Set.of(
            "metadata",
            "metadata.google.internal",
            "metadata.azure.internal",
            "instance-data.ec2.internal",
            "metadata.packet.net",
            "metadata.oraclecloud.com");
    private static final Duration DEFAULT_DNS_TIMEOUT = Duration.ofSeconds(2);
    private static final Duration MAX_DNS_TIMEOUT = Duration.ofSeconds(30);
    private static final ThreadPoolExecutor DNS_LOOKUP_EXECUTOR = createDnsLookupExecutor();

    private final AddressResolver addressResolver;
    private final Duration dnsTimeout;

    @Autowired
    public OutboundTargetPolicy() {
        this(InetAddress::getAllByName, DEFAULT_DNS_TIMEOUT);
    }

    public OutboundTargetPolicy(AddressResolver addressResolver) {
        this(addressResolver, DEFAULT_DNS_TIMEOUT);
    }

    public OutboundTargetPolicy(AddressResolver addressResolver, Duration dnsTimeout) {
        this.addressResolver = Objects.requireNonNull(addressResolver, "addressResolver must not be null");
        this.dnsTimeout = Objects.requireNonNull(dnsTimeout, "dnsTimeout must not be null");
        if (dnsTimeout.isZero() || dnsTimeout.isNegative() || dnsTimeout.compareTo(MAX_DNS_TIMEOUT) > 0) {
            throw new IllegalArgumentException("dnsTimeout must be positive and at most 30 seconds");
        }
    }

    /**
     * Approves an absolute HTTP(S) URI and returns every DNS answer that was
     * checked. A mixed safe/unsafe DNS answer is rejected as a whole.
     */
    public ApprovedTarget approve(URI uri) {
        validateUriShape(uri);
        String host = uri.getHost().toLowerCase(Locale.ROOT);

        final InetAddress[] resolved;
        Future<InetAddress[]> lookup;
        try {
            lookup = DNS_LOOKUP_EXECUTOR.submit(() -> addressResolver.resolve(host));
        } catch (RejectedExecutionException exception) {
            throw failure("DNS_RESOLUTION_FAILED", "The request destination could not be resolved.", true);
        }
        try {
            resolved = lookup.get(dnsTimeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException exception) {
            cancelLookup(lookup);
            throw failure("DNS_RESOLUTION_FAILED", "The request destination could not be resolved.", true);
        } catch (InterruptedException exception) {
            cancelLookup(lookup);
            Thread.currentThread().interrupt();
            throw failure("DNS_RESOLUTION_FAILED", "The request destination could not be resolved.", true);
        } catch (ExecutionException exception) {
            throw failure("DNS_RESOLUTION_FAILED", "The request destination could not be resolved.", true);
        }
        if (resolved == null || resolved.length == 0) {
            throw failure("DNS_RESOLUTION_FAILED", "The request destination could not be resolved.", true);
        }

        LinkedHashSet<InetAddress> unique = new LinkedHashSet<>();
        for (InetAddress address : resolved) {
            if (address == null || isUnsafe(address)) {
                throw failure("TARGET_BLOCKED", "The request destination is blocked.", false);
            }
            unique.add(address);
        }
        if (unique.isEmpty()) {
            throw failure("DNS_RESOLUTION_FAILED", "The request destination could not be resolved.", true);
        }
        return new ApprovedTarget(uri, List.copyOf(unique));
    }

    private static ThreadPoolExecutor createDnsLookupExecutor() {
        AtomicInteger sequence = new AtomicInteger();
        return new ThreadPoolExecutor(
                8,
                8,
                0,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(32),
                task -> {
                    Thread thread = new Thread(task, "workflow-http-dns-" + sequence.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy());
    }

    private static void cancelLookup(Future<InetAddress[]> lookup) {
        lookup.cancel(true);
        DNS_LOOKUP_EXECUTOR.remove((Runnable) lookup);
    }

    /** Validates syntax and authority without performing DNS resolution. */
    public void validateUriShape(URI uri) {
        if (uri == null
                || uri.toString().length() > MAX_URI_LENGTH
                || !uri.isAbsolute()
                || uri.getScheme() == null
                || !(uri.getScheme().equalsIgnoreCase("http")
                || uri.getScheme().equalsIgnoreCase("https"))
                || uri.getHost() == null
                || uri.getHost().isBlank()
                || uri.getRawAuthority() == null
                || uri.getRawUserInfo() != null
                || uri.getRawFragment() != null
                || uri.getPort() < -1
                || uri.getPort() > 65535
                || containsControl(uri.toString())) {
            throw failure("TARGET_BLOCKED", "The request destination is blocked.", false);
        }
        String host = uri.getHost();
        if (isMetadataHost(host)) {
            throw failure("TARGET_BLOCKED", "The request destination is blocked.", false);
        }
        InetAddress literal = literalAddress(host);
        if (literal != null && isUnsafe(literal)) {
            throw failure("TARGET_BLOCKED", "The request destination is blocked.", false);
        }
    }

    private boolean isUnsafe(InetAddress address) {
        byte[] bytes = address.getAddress();
        if (bytes.length == 16 && isIpv4Mapped(bytes)) {
            return true;
        }
        if (address.isAnyLocalAddress()
                || address.isLinkLocalAddress()
                || address.isLoopbackAddress()
                || address.isMulticastAddress()
                || address.isSiteLocalAddress()) {
            return true;
        }
        if (address instanceof Inet4Address || bytes.length == 4) {
            return isUnsafeIpv4(bytes);
        }
        if (address instanceof Inet6Address || bytes.length == 16) {
            return isUnsafeIpv6(bytes);
        }
        return true;
    }

    private boolean isUnsafeIpv4(byte[] bytes) {
        if (bytes.length != 4) {
            return true;
        }
        int first = Byte.toUnsignedInt(bytes[0]);
        int second = Byte.toUnsignedInt(bytes[1]);
        int third = Byte.toUnsignedInt(bytes[2]);
        int fourth = Byte.toUnsignedInt(bytes[3]);
        int value = (first << 24) | (second << 16) | (third << 8) | fourth;
        return first == 0
                || first == 10
                || (first == 100 && second >= 64 && second <= 127)
                || first == 127
                || (first == 169 && second == 254)
                || (first == 172 && second >= 16 && second <= 31)
                || (first == 192 && second == 0)
                || (first == 192 && second == 168)
                || (first == 198 && (second == 18 || second == 19))
                || (first == 198 && second == 51 && third == 100)
                || (first == 203 && second == 0 && third == 113)
                || first >= 224
                || value == 0xA9FEA9FE;
    }

    private boolean isUnsafeIpv6(byte[] bytes) {
        if (bytes.length != 16) {
            return true;
        }
        int first = Byte.toUnsignedInt(bytes[0]);
        int second = Byte.toUnsignedInt(bytes[1]);
        boolean globalUnicast = (first & 0xE0) == 0x20;
        boolean uniqueLocal = (first & 0xFE) == 0xFC;
        boolean linkLocal = first == 0xFE && (second & 0xC0) == 0x80;
        boolean documentation = first == 0x20
                && second == 0x01
                && bytes[2] == (byte) 0x0D
                && bytes[3] == (byte) 0xB8;
        return !globalUnicast || uniqueLocal || linkLocal || documentation
                || first == 0xFF || isReservedIpv6(bytes);
    }

    private boolean isReservedIpv6(byte[] bytes) {
        int group1 = (Byte.toUnsignedInt(bytes[0]) << 8) | Byte.toUnsignedInt(bytes[1]);
        int group2 = (Byte.toUnsignedInt(bytes[2]) << 8) | Byte.toUnsignedInt(bytes[3]);
        boolean ietfAssignments = group1 == 0x2001 && group2 <= 0x01FF;
        boolean special2001 = group1 == 0x2001
                && ((group2 & 0xFFF0) == 0x0010
                || (group2 & 0xFFF0) == 0x0020
                || (group2 & 0xFFF0) == 0x0030
                || group2 == 0x0DB8);
        boolean sixToFourOrSixBone = group1 == 0x2002 || group1 == 0x3FFE;
        boolean documentation = group1 == 0x3FFF;
        boolean nat64Prefix = group1 == 0x0064 && group2 == 0xFF9B;
        boolean discardOnly = group1 == 0x0100 && allZero(bytes, 2, 16);
        return ietfAssignments || special2001 || sixToFourOrSixBone
                || documentation || nat64Prefix || discardOnly;
    }

    private boolean allZero(byte[] bytes, int fromInclusive, int toExclusive) {
        for (int index = fromInclusive; index < toExclusive; index++) {
            if (bytes[index] != 0) {
                return false;
            }
        }
        return true;
    }

    private boolean isIpv4Mapped(byte[] bytes) {
        if (bytes.length != 16) {
            return false;
        }
        for (int index = 0; index < 10; index++) {
            if (bytes[index] != 0) {
                return false;
            }
        }
        return bytes[10] == (byte) 0xff && bytes[11] == (byte) 0xff;
    }

    private boolean isMetadataHost(String host) {
        String normalized = host.toLowerCase(Locale.ROOT);
        while (normalized.endsWith(".")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return METADATA_HOSTS.contains(normalized);
    }

    private InetAddress literalAddress(String host) {
        if (host.indexOf(':') < 0 && !host.matches("[0-9.]+")) {
            return null;
        }
        try {
            return InetAddress.getByName(host);
        } catch (UnknownHostException exception) {
            return null;
        }
    }

    private boolean containsControl(String value) {
        if (value.codePoints().anyMatch(codePoint -> codePoint < 0x20 || codePoint == 0x7f)) {
            return true;
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        return normalized.contains("%00")
                || normalized.contains("%0a")
                || normalized.contains("%0d");
    }

    private NodeExecutor.Failure failure(String code, String message, boolean retryable) {
        return new NodeExecutor.Failure(code, message, retryable);
    }

    @FunctionalInterface
    public interface AddressResolver {
        InetAddress[] resolve(String host) throws UnknownHostException;
    }

    public record ApprovedTarget(URI original, List<InetAddress> addresses) {
        public ApprovedTarget {
            Objects.requireNonNull(original, "original must not be null");
            Objects.requireNonNull(addresses, "addresses must not be null");
            if (addresses.isEmpty()) {
                throw new IllegalArgumentException("addresses must not be empty");
            }
            addresses = List.copyOf(addresses);
        }

        public String host() {
            return original.getHost().toLowerCase(Locale.ROOT);
        }
    }
}
