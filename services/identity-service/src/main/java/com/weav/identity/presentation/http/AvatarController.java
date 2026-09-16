package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.AvatarUrlResult;
import com.weav.identity.application.usecase.DeleteAvatarUseCase;
import com.weav.identity.application.usecase.GetAvatarUseCase;
import com.weav.identity.application.usecase.UpdateAvatarUseCase;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.presentation.http.mapper.UserPresentationMapper;
import com.weav.identity.presentation.http.response.AvatarUrlResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.UUID;

@RestController
@RequestMapping("/users/me/avatar")
public class AvatarController {

    private final UpdateAvatarUseCase updateAvatarUseCase;
    private final GetAvatarUseCase getAvatarUseCase;
    private final DeleteAvatarUseCase deleteAvatarUseCase;
    private final UserPresentationMapper userMapper;

    public AvatarController(
            UpdateAvatarUseCase updateAvatarUseCase,
            GetAvatarUseCase getAvatarUseCase,
            DeleteAvatarUseCase deleteAvatarUseCase,
            UserPresentationMapper userMapper
    ) {
        this.updateAvatarUseCase = updateAvatarUseCase;
        this.getAvatarUseCase = getAvatarUseCase;
        this.deleteAvatarUseCase = deleteAvatarUseCase;
        this.userMapper = userMapper;
    }

    @PutMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<UserResponse> updateAvatar(
            @AuthenticationPrincipal Jwt jwt,
            @RequestPart(value = "file", required = false) MultipartFile file
    ) {
        if (file == null) {
            throw new BadRequestException("Avatar file is required");
        }
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException exception) {
            throw new BadRequestException("Avatar file could not be read");
        }
        AuthenticatedUserResult result = updateAvatarUseCase.execute(
                userId,
                sessionId,
                bytes,
                file.getContentType());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(userMapper.toResponse(result));
    }

    @GetMapping
    public ResponseEntity<AvatarUrlResponse> getAvatar(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        AvatarUrlResult result = getAvatarUseCase.execute(userId, sessionId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new AvatarUrlResponse(result.url(), result.expiresAt()));
    }

    @DeleteMapping
    public ResponseEntity<Void> deleteAvatar(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
        deleteAvatarUseCase.execute(userId, sessionId);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }
}
