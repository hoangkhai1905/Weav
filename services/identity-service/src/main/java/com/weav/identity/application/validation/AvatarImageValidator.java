package com.weav.identity.application.validation;

import com.weav.identity.application.dto.AvatarImage;
import com.weav.identity.domain.exception.BadRequestException;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;
import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.Locale;
import java.util.Objects;

public final class AvatarImageValidator {

    public static final int MAX_BYTES = 2 * 1024 * 1024;
    public static final int MAX_DIMENSION = 4096;

    private static final String JPEG = "image/jpeg";
    private static final String PNG = "image/png";
    private static final String WEBP = "image/webp";

    static {
        ImageIO.scanForPlugins();
    }

    public AvatarImage normalize(byte[] input, String declaredContentType) {
        Objects.requireNonNull(input, "input must not be null");
        if (input.length == 0) {
            throw new BadRequestException("Avatar file must not be empty");
        }
        if (input.length > MAX_BYTES) {
            throw new BadRequestException("Avatar file must be at most 2 MiB");
        }

        String detectedContentType = detectMagic(input);
        if (declaredContentType != null && !declaredContentType.isBlank()) {
            String normalizedDeclared = declaredContentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
            if ("image/jpg".equals(normalizedDeclared)) {
                normalizedDeclared = JPEG;
            }
            if (!normalizedDeclared.equals("application/octet-stream")
                    && !normalizedDeclared.equals(detectedContentType)) {
                throw new BadRequestException("Avatar content type does not match the image bytes");
            }
        }

        BufferedImage image;
        try {
            image = decode(input, detectedContentType);
        } catch (IOException | RuntimeException exception) {
            if (exception instanceof BadRequestException badRequestException) {
                throw badRequestException;
            }
            throw new BadRequestException("Avatar image could not be decoded");
        }
        if (image == null || image.getWidth() < 1 || image.getHeight() < 1) {
            throw new BadRequestException("Avatar image could not be decoded");
        }
        if (image.getWidth() > MAX_DIMENSION || image.getHeight() > MAX_DIMENSION) {
            throw new BadRequestException("Avatar dimensions must be at most 4096 by 4096 pixels");
        }

        String extension = extensionFor(detectedContentType);
        byte[] normalized = encode(image, detectedContentType);
        if (normalized.length == 0 || normalized.length > MAX_BYTES) {
            throw new BadRequestException("Normalized avatar file must be at most 2 MiB");
        }
        return new AvatarImage(normalized, detectedContentType, extension);
    }

    private static String detectMagic(byte[] input) {
        if (input.length >= 3
                && (input[0] & 0xff) == 0xff
                && (input[1] & 0xff) == 0xd8
                && (input[2] & 0xff) == 0xff) {
            return JPEG;
        }
        if (input.length >= 8
                && (input[0] & 0xff) == 0x89
                && input[1] == 0x50
                && input[2] == 0x4e
                && input[3] == 0x47
                && input[4] == 0x0d
                && input[5] == 0x0a
                && input[6] == 0x1a
                && input[7] == 0x0a) {
            return PNG;
        }
        if (input.length >= 12
                && input[0] == 'R'
                && input[1] == 'I'
                && input[2] == 'F'
                && input[3] == 'F'
                && input[8] == 'W'
                && input[9] == 'E'
                && input[10] == 'B'
                && input[11] == 'P') {
            return WEBP;
        }
        throw new BadRequestException("Avatar must be a JPEG, PNG, or WebP image");
    }

    private static BufferedImage decode(byte[] input, String contentType) throws IOException {
        try (ImageInputStream imageInput = ImageIO.createImageInputStream(new ByteArrayInputStream(input))) {
            if (imageInput == null) {
                throw new BadRequestException("Avatar image could not be decoded");
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) {
                throw new BadRequestException("Avatar image format is not supported");
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(imageInput, true, true);
                String readerFormat = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!formatMatches(readerFormat, contentType)) {
                    throw new BadRequestException("Avatar image format is not supported");
                }
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    throw new BadRequestException("Avatar dimensions must be at most 4096 by 4096 pixels");
                }
                return reader.read(0);
            } finally {
                reader.dispose();
            }
        }
    }

    private static boolean formatMatches(String format, String contentType) {
        return switch (contentType) {
            case JPEG -> format.equals("jpeg") || format.equals("jpg");
            case PNG -> format.equals("png");
            case WEBP -> format.equals("webp");
            default -> false;
        };
    }

    private static byte[] encode(BufferedImage source, String contentType) {
        BufferedImage image = source;
        if (JPEG.equals(contentType)) {
            image = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_RGB);
            Graphics2D graphics = image.createGraphics();
            try {
                graphics.setComposite(AlphaComposite.Src);
                graphics.setColor(Color.WHITE);
                graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
                graphics.drawImage(source, 0, 0, null);
            } finally {
                graphics.dispose();
            }
        } else if (source.getType() == BufferedImage.TYPE_CUSTOM) {
            image = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = image.createGraphics();
            try {
                graphics.setComposite(AlphaComposite.Src);
                graphics.drawImage(source, 0, 0, null);
            } finally {
                graphics.dispose();
            }
        }

        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName(formatName(contentType));
        if (!writers.hasNext()) {
            throw new BadRequestException("Avatar image format cannot be normalized");
        }
        ImageWriter writer = writers.next();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ImageOutputStream imageOutput = ImageIO.createImageOutputStream(bytes)) {
            if (imageOutput == null) {
                throw new BadRequestException("Avatar image cannot be normalized");
            }
            writer.setOutput(imageOutput);
            ImageWriteParam writeParam = writer.getDefaultWriteParam();
            writer.write(null, new IIOImage(image, null, null), writeParam);
        } catch (IOException | RuntimeException exception) {
            if (exception instanceof BadRequestException badRequestException) {
                throw badRequestException;
            }
            throw new BadRequestException("Avatar image cannot be normalized");
        } finally {
            writer.dispose();
        }
        return bytes.toByteArray();
    }

    private static String formatName(String contentType) {
        return switch (contentType) {
            case JPEG -> "jpeg";
            case PNG -> "png";
            case WEBP -> "webp";
            default -> throw new IllegalArgumentException("unsupported avatar content type");
        };
    }

    private static String extensionFor(String contentType) {
        return switch (contentType) {
            case JPEG -> "jpg";
            case PNG -> "png";
            case WEBP -> "webp";
            default -> throw new IllegalArgumentException("unsupported avatar content type");
        };
    }
}
