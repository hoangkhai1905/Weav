package com.weav.identity.application.dto;

import java.util.Arrays;

public record AvatarImage(byte[] content, String contentType, String extension) {
    public AvatarImage {
        content = Arrays.copyOf(content, content.length);
    }

    @Override
    public byte[] content() {
        return Arrays.copyOf(content, content.length);
    }
}
