package com.weav.workflow.infrastructure.http;

import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OutboundTargetPolicyTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "http://127.0.0.1/",
            "http://0.0.0.0/",
            "http://10.0.0.1/",
            "http://100.64.0.1/",
            "http://172.16.0.1/",
            "http://192.0.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/",
            "http://metadata/",
            "http://metadata.google.internal/",
            "http://[::1]/",
            "http://[::]/",
            "http://[fe80::1]/",
            "http://[fc00::1]/",
            "http://[ff02::1]/",
            "http://[2001:db8::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[::ffff:169.254.169.254]/",
            "http://user:password@example.test/",
            "https://example.test/path%0d%0aX-Injected:%20value",
            "file:///etc/passwd"
    })
    void rejectsUnsafeTargetsBeforeTransport(String rawUrl) {
        OutboundTargetPolicy policy = new OutboundTargetPolicy(
                ignored -> new InetAddress[]{address("93.184.216.34")});

        assertThrows(NodeExecutor.Failure.class, () -> policy.approve(URI.create(rawUrl)));
    }

    @Test
    void acceptsPublicAddressesAndReturnsThePinnedSet() {
        InetAddress first = address("93.184.216.34");
        InetAddress second = address("93.184.216.35");
        OutboundTargetPolicy policy = new OutboundTargetPolicy(
                ignored -> new InetAddress[]{first, second});

        OutboundTargetPolicy.ApprovedTarget target = policy.approve(
                URI.create("https://Api.Example.test/resource"));

        assertEquals("https://Api.Example.test/resource", target.original().toString());
        assertEquals(List.of(first, second), target.addresses());
        assertFalse(target.addresses().isEmpty());
    }

    @Test
    void rejectsEveryAnswerWhenDnsReturnsOneForbiddenAddress() {
        OutboundTargetPolicy policy = new OutboundTargetPolicy(
                ignored -> new InetAddress[]{address("93.184.216.34"), address("192.168.1.10")});

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> policy.approve(URI.create("https://api.example.test/")));

        assertEquals("TARGET_BLOCKED", failure.code());
        assertFalse(failure.retryable());
    }

    @Test
    void resolvesExactlyOnceForTheApprovedTarget() {
        AtomicInteger resolutions = new AtomicInteger();
        OutboundTargetPolicy policy = new OutboundTargetPolicy(host -> {
            resolutions.incrementAndGet();
            return new InetAddress[]{address("93.184.216.34")};
        });

        policy.approve(URI.create("https://api.example.test/"));

        assertEquals(1, resolutions.get());
    }

    @Test
    void mapsDnsFailureToSafeRetryableFailure() {
        OutboundTargetPolicy policy = new OutboundTargetPolicy(host -> {
            throw new UnknownHostException("synthetic-secret-host");
        });

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> policy.approve(URI.create("https://api.example.test/")));

        assertEquals("DNS_RESOLUTION_FAILED", failure.code());
        assertTrue(failure.retryable());
        assertFalse(failure.safeMessage().contains("synthetic-secret-host"));
    }

    @Test
    void boundsTimeSpentWaitingForDnsResolution() throws Exception {
        CountDownLatch resolutionStarted = new CountDownLatch(1);
        OutboundTargetPolicy policy = new OutboundTargetPolicy(host -> {
            resolutionStarted.countDown();
            try {
                Thread.sleep(5_000);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return new InetAddress[]{address("93.184.216.34")};
        }, Duration.ofMillis(50));
        long startedAt = System.nanoTime();

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> policy.approve(URI.create("https://slow-dns.example.test/")));
        long elapsed = System.nanoTime() - startedAt;

        assertTrue(resolutionStarted.await(1, TimeUnit.SECONDS));
        assertEquals("DNS_RESOLUTION_FAILED", failure.code());
        assertTrue(failure.retryable());
        assertTrue(elapsed < Duration.ofSeconds(1).toNanos());
    }

    @Test
    void rejectsMappedIpv6EvenWhenItContainsAReachablePublicIpv4() {
        Inet6Address mapped = mappedAddress("93.184.216.34");
        OutboundTargetPolicy policy = new OutboundTargetPolicy(ignored -> new InetAddress[]{mapped});

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> policy.approve(URI.create("https://api.example.test/")));

        assertEquals("TARGET_BLOCKED", failure.code());
    }

    private static InetAddress address(String text) {
        try {
            return InetAddress.getByName(text);
        } catch (UnknownHostException exception) {
            throw new AssertionError(exception);
        }
    }

    private static Inet6Address mappedAddress(String ipv4) {
        byte[] bytes = new byte[16];
        byte[] ipv4Bytes = address(ipv4).getAddress();
        bytes[10] = (byte) 0xff;
        bytes[11] = (byte) 0xff;
        System.arraycopy(ipv4Bytes, 0, bytes, 12, 4);
        try {
            return Inet6Address.getByAddress("mapped", bytes, -1);
        } catch (UnknownHostException exception) {
            throw new AssertionError(exception);
        }
    }
}
