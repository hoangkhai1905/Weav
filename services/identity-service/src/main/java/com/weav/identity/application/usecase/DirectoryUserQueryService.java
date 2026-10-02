package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.UserDirectoryPage;
import com.weav.identity.application.dto.UserDirectorySummary;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;

@Service
public final class DirectoryUserQueryService {

    public static final int MAX_CANDIDATES = 500;
    public static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_SEARCH_LENGTH = 120;

    private final UserRepository userRepository;
    private final AuthInputPolicy inputPolicy;

    public DirectoryUserQueryService(
            UserRepository userRepository,
            AuthInputPolicy inputPolicy) {
        this.userRepository = Objects.requireNonNull(userRepository);
        this.inputPolicy = Objects.requireNonNull(inputPolicy);
    }

    public Optional<UserDirectorySummary> findByEmail(String email) {
        String normalizedEmail = normalizeEmail(email);
        return userRepository.findByEmail(normalizedEmail).map(UserDirectorySummary::from);
    }

    public Set<UUID> matchUserIds(Collection<UUID> candidateUserIds, String search) {
        List<UUID> candidates = boundedCandidates(candidateUserIds);
        if (candidates.isEmpty()) {
            return Set.of();
        }
        String normalizedSearch = normalizeSearch(search);
        Map<UUID, User> users = usersById(candidates);
        LinkedHashSet<UUID> matching = new LinkedHashSet<>();
        for (UUID candidate : candidates) {
            User user = users.get(candidate);
            if (user != null && matches(user, normalizedSearch)) {
                matching.add(candidate);
            }
        }
        return Set.copyOf(matching);
    }

    public UserDirectoryPage searchUsers(
            Collection<UUID> candidateUserIds,
            String search,
            int page,
            int size,
            String direction) {
        validatePage(page, size);
        boolean descending = parseDirection(direction);
        List<UUID> candidates = boundedCandidates(candidateUserIds);
        if (candidates.isEmpty()) {
            return new UserDirectoryPage(List.of(), page, size, 0, 0);
        }

        String normalizedSearch = normalizeSearch(search);
        List<UserDirectorySummary> matches = usersById(candidates).values().stream()
                .filter(user -> matches(user, normalizedSearch))
                .map(UserDirectorySummary::from)
                .sorted(directoryComparator(descending))
                .toList();

        long totalElements = matches.size();
        int totalPages = totalElements == 0 ? 0 : Math.toIntExact((totalElements - 1) / size + 1);
        long offset = Math.multiplyExact((long) page, size);
        int from = offset >= totalElements ? matches.size() : Math.toIntExact(offset);
        int to = Math.min(matches.size(), Math.toIntExact(Math.min(totalElements, offset + size)));
        return new UserDirectoryPage(matches.subList(from, to), page, size, totalElements, totalPages);
    }

    public List<UserDirectorySummary> getUsersByIds(Collection<UUID> userIds) {
        List<UUID> requested = boundedCandidates(userIds);
        if (requested.isEmpty()) {
            return List.of();
        }
        Map<UUID, User> users = usersById(requested);
        return requested.stream()
                .map(users::get)
                .filter(Objects::nonNull)
                .map(UserDirectorySummary::from)
                .toList();
    }

    private Map<UUID, User> usersById(List<UUID> candidates) {
        Map<UUID, User> users = new HashMap<>();
        for (User user : userRepository.findAllByIds(candidates)) {
            users.put(user.getId(), user);
        }
        return users;
    }

    private boolean matches(User user, String search) {
        return search.isEmpty()
                || containsIgnoreCase(user.getEmail(), search)
                || containsIgnoreCase(user.getDisplayName(), search);
    }

    private boolean containsIgnoreCase(String value, String search) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(search);
    }

    private Comparator<UserDirectorySummary> directoryComparator(boolean descending) {
        return (left, right) -> {
            int nameResult;
            if (left.displayName() == null && right.displayName() == null) {
                nameResult = 0;
            } else if (left.displayName() == null) {
                nameResult = 1;
            } else if (right.displayName() == null) {
                nameResult = -1;
            } else {
                nameResult = left.displayName().toLowerCase(Locale.ROOT)
                        .compareTo(right.displayName().toLowerCase(Locale.ROOT));
                if (descending) {
                    nameResult = -nameResult;
                }
            }
            return nameResult != 0 ? nameResult : left.userId().compareTo(right.userId());
        };
    }

    private List<UUID> boundedCandidates(Collection<UUID> candidateUserIds) {
        Objects.requireNonNull(candidateUserIds, "candidateUserIds must not be null");
        if (candidateUserIds.size() > MAX_CANDIDATES) {
            throw new BadRequestException("candidateUserIds must contain at most " + MAX_CANDIDATES + " IDs");
        }
        LinkedHashSet<UUID> unique = new LinkedHashSet<>();
        for (UUID id : candidateUserIds) {
            if (id == null) {
                throw new BadRequestException("candidateUserIds must not contain null IDs");
            }
            unique.add(id);
        }
        return new ArrayList<>(unique);
    }

    private String normalizeEmail(String email) {
        return inputPolicy.canonicalizeEmail(email);
    }

    private String normalizeSearch(String search) {
        if (search == null || search.isBlank()) {
            return "";
        }
        String normalized = search.trim().toLowerCase(Locale.ROOT);
        if (normalized.length() > MAX_SEARCH_LENGTH) {
            throw new BadRequestException("search must be at most " + MAX_SEARCH_LENGTH + " characters");
        }
        return normalized;
    }

    private void validatePage(int page, int size) {
        if (page < 0) {
            throw new BadRequestException("page must not be negative");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new BadRequestException("size must be between 1 and " + MAX_PAGE_SIZE);
        }
    }

    private boolean parseDirection(String direction) {
        if (direction == null || direction.isBlank() || "asc".equalsIgnoreCase(direction)) {
            return false;
        }
        if ("desc".equalsIgnoreCase(direction)) {
            return true;
        }
        throw new BadRequestException("direction must be asc or desc");
    }
}
