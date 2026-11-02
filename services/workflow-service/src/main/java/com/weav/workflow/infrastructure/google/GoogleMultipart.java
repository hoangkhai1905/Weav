package com.weav.workflow.infrastructure.google;

import com.weav.workflow.infrastructure.http.PinnedHttpTransport;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/** Builds the {@code multipart/related} body of a Drive upload (JSON metadata part, then the media part). */
final class GoogleMultipart {

    private GoogleMultipart() {
    }

    static PinnedHttpTransport.RawBody related(
            String boundary, String metadataJson, String mediaType, byte[] content) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(content.length + metadataJson.length() + 256);
        write(out, "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                + metadataJson + "\r\n--" + boundary + "\r\nContent-Type: " + mediaType + "\r\n\r\n");
        out.writeBytes(content);
        write(out, "\r\n--" + boundary + "--");
        return new PinnedHttpTransport.RawBody(out.toByteArray(), "multipart/related; boundary=" + boundary);
    }

    private static void write(ByteArrayOutputStream out, String text) {
        out.writeBytes(text.getBytes(StandardCharsets.UTF_8));
    }
}
