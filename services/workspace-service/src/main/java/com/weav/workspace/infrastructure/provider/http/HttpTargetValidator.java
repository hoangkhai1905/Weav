package com.weav.workspace.infrastructure.provider.http;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Validates and resolves HTTP targets immediately before an outbound request.
 *
 * <p>The returned address set is later installed in the transport's DNS
 * resolver. That keeps the actual socket pinned to the addresses checked
 * here, instead of performing a second resolver lookup after validation.</p>
 */
public final class HttpTargetValidator {

    private static final Set<String> METADATA_HOSTS = Set.of(
            "metadata",
            "metadata.google.internal",
            "metadata.azure.internal",
            "instance-data.ec2.internal",
            "metadata.packet.net",
            "metadata.oraclecloud.com");

    private final AddressResolver addressResolver;
    private final boolean allowLoopbackForTests;

    public HttpTargetValidator() {
        this(InetAddress::getAllByName, false);
    }

    /**
     * Explicit test/local-fixture escape hatch. It permits loopback only;
     * private, link-local, metadata, multicast, and reserved targets remain
     * blocked.
     */
    public HttpTargetValidator(boolean allowLoopbackForTests) {
        this(InetAddress::getAllByName, allowLoopbackForTests);
    }

    public HttpTargetValidator(AddressResolver addressResolver, boolean allowLoopbackForTests) {
        this.addressResolver = Objects.requireNonNull(addressResolver, "addressResolver must not be null");
        this.allowLoopbackForTests = allowLoopbackForTests;
    }

    /**
     * Checks URI syntax and authority without performing DNS. Use this for
     * persisted configuration validation so a temporary DNS outage is not
     * mistaken for invalid configuration.
     */
    public void validateUriShape(URI uri) {
        Objects.requireNonNull(uri, "uri must not be null");
        String scheme = uri.getScheme();
        if (!uri.isAbsolute()
                || scheme == null
                || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                || uri.getHost() == null
                || uri.getHost().isBlank()
                || uri.getRawUserInfo() != null
                || uri.getRawFragment() != null) {
            throw invalidTarget();
        }
        if (uri.getPort() < -1 || uri.getPort() > 65535) {
            throw invalidTarget();
        }
        if (isMetadataHost(uri.getHost())) {
            throw invalidTarget();
        }
    }

    /**
     * Resolves every address and rejects the whole target if any answer is
     * unsafe. Unknown DNS failures are dependency failures by design.
     */
    public ValidatedTarget validateAndResolve(URI uri) {
        validateUriShape(uri);
        String host = uri.getHost();
        final InetAddress[] resolved;
        try {
            resolved = addressResolver.resolve(host);
        } catch (UnknownHostException exception) {
            throw new DependencyUnavailableException();
        } catch (RuntimeException exception) {
            throw new DependencyUnavailableException();
        }
        if (resolved == null || resolved.length == 0) {
            throw new DependencyUnavailableException();
        }

        LinkedHashSet<InetAddress> unique = new LinkedHashSet<>();
        for (InetAddress address : resolved) {
            if (address == null || isUnsafe(address)) {
                throw invalidTarget();
            }
            unique.add(address);
        }
        if (unique.isEmpty()) {
            throw new DependencyUnavailableException();
        }

        String normalizedHost = host.toLowerCase(Locale.ROOT);
        return new ValidatedTarget(uri, normalizedHost,
                uri.getPort() >= 0 ? uri.getPort() : defaultPort(uri),
                List.copyOf(unique));
    }

    private boolean isUnsafe(InetAddress address) {
        byte[] bytes = address.getAddress();
        // IPv4-mapped addresses are special-use IPv6 representations, even
        // when the embedded IPv4 value happens to be public. Treating them as
        // ordinary IPv4 would allow a representation change to bypass the
        // IPv6 target policy.
        if (bytes.length == 16 && isIpv4Mapped(bytes)) {
            return true;
        }
        if (allowLoopbackForTests && address.isLoopbackAddress()) {
            return false;
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
            if (isIpv4Compatible(bytes)) {
                return true;
            }
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

        if (first == 127 && allowLoopbackForTests) {
            return false;
        }
        return first == 0
                || first == 10
                || (first == 100 && second >= 64 && second <= 127)
                || (first == 127)
                || (first == 169 && second == 254)
                || (first == 172 && second >= 16 && second <= 31)
                || (first == 192 && second == 0)
                || (first == 192 && second == 168)
                || (first == 198 && (second == 18 || second == 19))
                || (first == 198 && second == 51 && third == 100)
                || (first == 203 && second == 0 && third == 113)
                || first >= 224
                || value == 0xA9FEA9FE; // 169.254.169.254 metadata endpoint
    }

    private boolean isUnsafeIpv6(byte[] bytes) {
        int first = Byte.toUnsignedInt(bytes[0]);
        int second = Byte.toUnsignedInt(bytes[1]);
        // Only 2000::/3 is global-unicast space. This rejects unspecified,
        // link-local, ULA, multicast, IPv4-transition, and unallocated
        // non-global prefixes before checking the registered special ranges.
        boolean globalUnicast = (first & 0xE0) == 0x20;
        boolean uniqueLocal = (first & 0xFE) == 0xFC;
        boolean linkLocal = first == 0xFE && (second & 0xC0) == 0x80;
        boolean documentation = first == 0x20
                && second == 0x01
                && bytes[2] == (byte) 0x0D
                && bytes[3] == (byte) 0xB8;
        return !globalUnicast || uniqueLocal || linkLocal || documentation || first == 0xFF
                || isReservedIpv6(bytes);
    }

    private boolean isReservedIpv6(byte[] bytes) {
        int group1 = (Byte.toUnsignedInt(bytes[0]) << 8) | Byte.toUnsignedInt(bytes[1]);
        int group2 = (Byte.toUnsignedInt(bytes[2]) << 8) | Byte.toUnsignedInt(bytes[3]);

        // The IANA IPv6 special-purpose registry reserves 2001::/23 for
        // protocol assignments unless a more-specific allocation applies.
        // Rejecting the complete parent range is the conservative choice for
        // an arbitrary user-controlled destination.
        boolean ietfAssignments = group1 == 0x2001 && group2 <= 0x01FF;
        boolean special2001 = group1 == 0x2001
                && ((group2 & 0xFFF0) == 0x0010
                || ((group2 & 0xFFF0) == 0x0020)
                || ((group2 & 0xFFF0) == 0x0030)
                || (group2 == 0x0DB8));
        boolean sixToFourOrSixBone = group1 == 0x2002 || group1 == 0x3FFE;
        boolean documentation = group1 == 0x3FFF;
        // IPv4-transition and discard-only ranges are special-use and cannot
        // be treated as ordinary globally routable service addresses.
        boolean nat64Prefix = group1 == 0x0064
                && group2 == 0xFF9B;
        boolean discardOnly = group1 == 0x0100 && allZero(bytes, 2, 8);
        return ietfAssignments
                || special2001
                || sixToFourOrSixBone
                || documentation
                || nat64Prefix
                || discardOnly;
    }

    private boolean allZero(byte[] bytes, int fromInclusive, int toExclusive) {
        for (int i = fromInclusive; i < toExclusive; i++) {
            if (bytes[i] != 0) {
                return false;
            }
        }
        return true;
    }

    private boolean isIpv4Mapped(byte[] bytes) {
        if (bytes.length != 16) {
            return false;
        }
        for (int i = 0; i < 10; i++) {
            if (bytes[i] != 0) {
                return false;
            }
        }
        return bytes[10] == (byte) 0xFF && bytes[11] == (byte) 0xFF;
    }

    private boolean isIpv4Compatible(byte[] bytes) {
        if (bytes.length != 16) {
            return false;
        }
        for (int i = 0; i < 12; i++) {
            if (bytes[i] != 0) {
                return false;
            }
        }
        return true;
    }

    private boolean isMetadataHost(String host) {
        String normalized = host.toLowerCase(Locale.ROOT);
        while (normalized.endsWith(".")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return METADATA_HOSTS.contains(normalized);
    }

    private int defaultPort(URI uri) {
        return uri.getScheme().equalsIgnoreCase("https") ? 443 : 80;
    }

    private BadRequestException invalidTarget() {
        return new BadRequestException("HTTP connection target is invalid or blocked");
    }

    @FunctionalInterface
    public interface AddressResolver {
        InetAddress[] resolve(String host) throws UnknownHostException;
    }

    public record ValidatedTarget(
            URI uri,
            String host,
            int port,
            List<InetAddress> addresses) {

        public ValidatedTarget {
            Objects.requireNonNull(uri, "uri must not be null");
            Objects.requireNonNull(host, "host must not be null");
            Objects.requireNonNull(addresses, "addresses must not be null");
            addresses = List.copyOf(addresses);
        }
    }
}
