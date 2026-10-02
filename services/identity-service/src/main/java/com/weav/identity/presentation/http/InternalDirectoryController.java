package com.weav.identity.presentation.http;

import com.weav.identity.application.dto.UserDirectoryIdSet;
import com.weav.identity.application.dto.UserDirectoryPage;
import com.weav.identity.application.dto.UserDirectorySummary;
import com.weav.identity.application.usecase.DirectoryUserQueryService;
import com.weav.identity.domain.exception.ResourceNotFoundException;
import com.weav.identity.presentation.http.request.DirectoryBatchRequest;
import com.weav.identity.presentation.http.request.DirectoryEmailLookupRequest;
import com.weav.identity.presentation.http.request.DirectoryMatchRequest;
import com.weav.identity.presentation.http.request.DirectorySearchRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/internal/directory/users")
public class InternalDirectoryController {

    private final DirectoryUserQueryService directoryUserQueryService;

    public InternalDirectoryController(DirectoryUserQueryService directoryUserQueryService) {
        this.directoryUserQueryService = directoryUserQueryService;
    }

    @PostMapping("/by-email")
    public UserDirectorySummary byEmail(@Valid @RequestBody DirectoryEmailLookupRequest request) {
        return directoryUserQueryService.findByEmail(request.email())
                .orElseThrow(() -> new ResourceNotFoundException("Directory user not found"));
    }

    @PostMapping("/match")
    public UserDirectoryIdSet match(@Valid @RequestBody DirectoryMatchRequest request) {
        return new UserDirectoryIdSet(
                directoryUserQueryService.matchUserIds(request.candidateUserIds(), request.search()));
    }

    @PostMapping("/search")
    public UserDirectoryPage search(@Valid @RequestBody DirectorySearchRequest request) {
        return directoryUserQueryService.searchUsers(
                request.candidateUserIds(),
                request.search(),
                request.page(),
                request.size(),
                request.direction());
    }

    @PostMapping("/batch")
    public List<UserDirectorySummary> batch(@Valid @RequestBody DirectoryBatchRequest request) {
        return directoryUserQueryService.getUsersByIds(request.userIds());
    }
}
