package com.weav.identity.application.validation;

import com.weav.identity.application.dto.AvatarImage;
import com.weav.identity.domain.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AvatarImageValidatorTest {

    private final AvatarImageValidator validator = new AvatarImageValidator();

    @Test
    void acceptsAndNormalizesJpegPngAndWebp() throws Exception {
        for (String format : new String[]{"jpeg", "png", "webp"}) {
            byte[] input = image(format, 32, 24);

            AvatarImage normalized = validator.normalize(input, "image/" + format);

            assertEquals("jpeg".equals(format) ? "image/jpeg" : "image/" + format,
                    normalized.contentType());
            assertEquals("jpeg".equals(format) ? "jpg" : format, normalized.extension());
            assertTrue(normalized.content().length > 0);
            assertTrue(normalized.content().length <= AvatarImageValidator.MAX_BYTES);
        }
    }

    @Test
    void rejectsEmptyOversizeUnsupportedAndMismatchedContent() throws Exception {
        assertThrows(BadRequestException.class, () -> validator.normalize(new byte[0], "image/png"));
        assertThrows(BadRequestException.class, () -> validator.normalize(
                new byte[AvatarImageValidator.MAX_BYTES + 1], "image/png"));
        assertThrows(BadRequestException.class, () -> validator.normalize("not-an-image".getBytes(), null));
        assertThrows(BadRequestException.class, () -> validator.normalize(image("png", 4, 4), "image/jpeg"));
    }

    @Test
    void rejectsDisguisedExecutableAndOversizedDimensions() throws Exception {
        byte[] executable = new byte[]{
                (byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
                'M', 'Z', 0, 0, 0, 0, 0, 0
        };

        assertThrows(BadRequestException.class, () -> validator.normalize(executable, "image/png"));
        assertThrows(BadRequestException.class, () -> validator.normalize(
                image("png", AvatarImageValidator.MAX_DIMENSION + 1, 1), "image/png"));
    }

    @Test
    void outputIsDecoderValidAndDoesNotReuseInputBytes() throws Exception {
        byte[] input = image("png", 16, 16);

        AvatarImage normalized = validator.normalize(input, "image/png");
        BufferedImage decoded = ImageIO.read(new java.io.ByteArrayInputStream(normalized.content()));

        assertEquals(16, decoded.getWidth());
        assertEquals(16, decoded.getHeight());
        assertTrue(normalized.content() != input);
    }

    private static byte[] image(String format, int width, int height) throws IOException {
        int imageType = "jpeg".equals(format) ? BufferedImage.TYPE_INT_RGB : BufferedImage.TYPE_INT_ARGB;
        BufferedImage image = new BufferedImage(width, height, imageType);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                image.setRGB(x, y, new Color((x * 17) & 0xff, (y * 23) & 0xff, 127).getRGB());
            }
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!ImageIO.write(image, format, output)) {
            throw new IOException("ImageIO writer unavailable for " + format);
        }
        return output.toByteArray();
    }
}
