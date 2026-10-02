package com.weav.workspace.infrastructure.provider.http;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.net.Inet6Address;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpTargetValidatorTest {

    @Test
    void validatesSafePublicAddressAndReturnsEveryResolvedAddress() throws Exception {
        InetAddress first = address("93.184.216.34");
        InetAddress second = address("93.184.216.35");
        HttpTargetValidator validator = new HttpTargetValidator(
                host -> new InetAddress[] {first, second}, false);

        HttpTargetValidator.ValidatedTarget result = validator.validateAndResolve(
                URI.create("https://api.example.test/health"));

        assertEquals("api.example.test", result.host());
        assertEquals(443, result.port());
        assertEquals(List.of(first, second), result.addresses());
    }

    @Test
    void acceptsGlobalUnicastIpv6AndRejectsNonGlobalSpecialUseVariants() throws Exception {
        InetAddress publicIpv6 = address("2001:4860:4860::8888");
        HttpTargetValidator validator = new HttpTargetValidator(
                ignored -> new InetAddress[] {publicIpv6}, false);
        assertEquals(List.of(publicIpv6), validator.validateAndResolve(
                URI.create("https://api.example.test/health")).addresses());

        List<String> blocked = List.of(
                "4000::1", // outside 2000::/3 global-unicast space
                "3fff::1", // IANA documentation range
                "5f00::1", // IANA SRv6 SID range outside global-unicast space
                "::93.184.216.34", // deprecated IPv4-compatible form
                "64:ff9b::5db8:d822", // well-known NAT64 prefix
                "64:ff9b:1::1"); // network-specific NAT64 prefix
        for (String text : blocked) {
            HttpTargetValidator blockedValidator = new HttpTargetValidator(
                    ignored -> new InetAddress[] {address(text)}, false);
            assertThrows(BadRequestException.class, () -> blockedValidator.validateAndResolve(
                    URI.create("https://api.example.test/health")), text);
        }

        HttpTargetValidator mappedValidator = new HttpTargetValidator(
                ignored -> new InetAddress[] {mappedAddress("93.184.216.34")}, false);
        assertThrows(BadRequestException.class, () -> mappedValidator.validateAndResolve(
                URI.create("https://api.example.test/health")));
    }

    @Test
    void rejectsMalformedAuthoritiesUserInfoMetadataAndUnsafeSchemesBeforeDns() {
        AtomicInteger resolutions = new AtomicInteger();
        HttpTargetValidator validator = new HttpTargetValidator(host -> {
            resolutions.incrementAndGet();
            return new InetAddress[] {address("93.184.216.34")};
        }, false);

        for (String raw : List.of(
                "ftp://api.example.test/health",
                "https:///health",
                "https://user:password@api.example.test/health",
                "https://metadata.google.internal/computeMetadata/v1")) {
            assertThrows(BadRequestException.class,
                    () -> validator.validateAndResolve(URI.create(raw)));
        }
        assertEquals(0, resolutions.get());
    }

    @Test
    void rejectsPrivateLoopbackLinkLocalMetadataMulticastReservedAndMappedAddresses() {
        List<String> blocked = List.of(
                "127.0.0.1",
                "10.0.0.1",
                "172.16.0.1",
                "192.168.1.1",
                "169.254.1.1",
                "0.0.0.0",
                "100.64.0.1",
                "192.0.0.1",
                "198.18.0.1",
                "198.51.100.1",
                "203.0.113.1",
                "224.0.0.1",
                "240.0.0.1",
                "::1",
                "fc00::1",
                "fe80::1",
                "ff02::1",
                "2001:0::1",
                "2001:2::1",
                "2001:10::1",
                "2001:db8::1",
                "2001:30::1",
                "2002::1",
                "3ffe::1",
                "3fff::1",
                "4000::1",
                "64:ff9b::c000:0201",
                "64:ff9b:1::1",
                "::ffff:127.0.0.1",
                "::93.184.216.34");

        for (String address : blocked) {
            HttpTargetValidator validator = new HttpTargetValidator(
                    ignored -> new InetAddress[] {address(address)}, false);
            assertThrows(BadRequestException.class, () -> validator.validateAndResolve(
                    URI.create("https://api.example.test/health")), address);
        }
    }

    @Test
    void explicitTestOverridePermitsOnlyLoopback() {
        HttpTargetValidator validator = new HttpTargetValidator(
                ignored -> new InetAddress[] {address("127.0.0.1")}, true);

        HttpTargetValidator.ValidatedTarget result = validator.validateAndResolve(
                URI.create("http://localhost/health"));

        assertTrue(result.addresses().getFirst().isLoopbackAddress());
        assertFalse(result.addresses().isEmpty());

        HttpTargetValidator privateValidator = new HttpTargetValidator(
                ignored -> new InetAddress[] {address("10.0.0.1")}, true);
        assertThrows(BadRequestException.class, () -> privateValidator.validateAndResolve(
                URI.create("http://localhost/health")));
    }

    @Test
    void dnsFailureIsDependencyFailureWithoutOriginalDiagnostic() {
        HttpTargetValidator validator = new HttpTargetValidator(
                ignored -> {
                    throw new UnknownHostException("synthetic-sensitive-host");
                }, false);

        DependencyUnavailableException exception = assertThrows(
                DependencyUnavailableException.class,
                () -> validator.validateAndResolve(URI.create("https://api.example.test")));

        assertFalse(exception.getMessage().contains("synthetic-sensitive-host"));
        assertEquals(null, exception.getCause());
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
        bytes[10] = (byte) 0xFF;
        bytes[11] = (byte) 0xFF;
        System.arraycopy(ipv4Bytes, 0, bytes, 12, 4);
        try {
            return Inet6Address.getByAddress("mapped", bytes, -1);
        } catch (UnknownHostException exception) {
            throw new AssertionError(exception);
        }
    }
}
