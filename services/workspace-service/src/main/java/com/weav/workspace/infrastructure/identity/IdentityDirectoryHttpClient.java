package com.weav.workspace.infrastructure.identity;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.query.SortDirection;
import com.weav.workspace.application.validation.IdentityEmailNormalizer;
import com.weav.workspace.infrastructure.web.RequestCorrelationFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatusCode;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.UUID;

/**
 * RestClient adapter for Identity's internal directory API.
 *
 * The adapter owns transport chunking and the global display-name merge so
 * callers never need to know the per-request Identity bound.
 */
public final class IdentityDirectoryHttpClient implements IdentityDirectoryPort {

    private static final Logger log = LoggerFactory.getLogger(IdentityDirectoryHttpClient.class);
    private static final String INTERNAL_KEY_HEADER = "X-Internal-Service-Key";
    private static final int MAX_TRANSPORT_IDS = 500;
    private static final int IDENTITY_PAGE_SIZE = 100;
    private static final int MAX_SEARCH_LENGTH = 120;

    private final RestClient restClient;
    private final IdentityDirectoryProperties properties;

    public IdentityDirectoryHttpClient(
            RestClient restClient,
            IdentityDirectoryProperties properties) {
        this.restClient = Objects.requireNonNull(restClient, "restClient must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
    }

    @Override
    public Optional<IdentityUserSummary> findByEmail(String normalizedEmail) {
        String email = normalizeEmail(normalizedEmail);
        long started = System.nanoTime();
        try {
            UserSummaryPayload payload = request("/internal/directory/users/by-email")
                    .body(new EmailLookupRequest(email))
                    .retrieve()
                    .body(UserSummaryPayload.class);
            return Optional.of(toSummary(requirePayload(payload)));
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 404) {
                return Optional.empty();
            }
            if (isDependencyFailure(exception.getStatusCode())) {
                logDependencyFailure("findByEmail", exception, started);
            }
            throw mapResponseFailure(exception.getStatusCode());
        } catch (RestClientException exception) {
            logDependencyFailure("findByEmail", exception, started);
            throw new DependencyUnavailableException();
        }
    }

    @Override
    public Set<UUID> matchUserIds(Collection<UUID> candidateUserIds, String search) {
        List<UUID> candidates = normalizedIds(candidateUserIds, "candidateUserIds");
        if (candidates.isEmpty()) {
            return Set.of();
        }
        String normalizedSearch = normalizeSearch(search);
        LinkedHashSet<UUID> matching = new LinkedHashSet<>();
        for (List<UUID> chunk : chunks(candidates)) {
            MatchingIdsPayload payload = post(
                    "/internal/directory/users/match",
                    new CandidateMatchRequest(chunk, normalizedSearch),
                    MatchingIdsPayload.class);
            if (payload.matchingUserIds() == null) {
                throw new DependencyUnavailableException();
            }
            Set<UUID> chunkCandidates = Set.copyOf(chunk);
            for (UUID id : payload.matchingUserIds()) {
                if (id == null || !chunkCandidates.contains(id)) {
                    throw new DependencyUnavailableException();
                }
                matching.add(id);
            }
        }
        return Set.copyOf(matching);
    }

    @Override
    public PageResult<IdentityUserSummary> searchUsersByDisplayName(
            Collection<UUID> candidateUserIds,
            String search,
            int page,
            int size,
            SortDirection direction) {
        validatePage(page, size, direction);
        List<UUID> candidates = normalizedIds(candidateUserIds, "candidateUserIds");
        if (candidates.isEmpty()) {
            return new PageResult<>(List.of(), page, size, 0, 0);
        }
        String normalizedSearch = normalizeSearch(search);
        Comparator<IdentityUserSummary> comparator = comparator(direction);
        List<List<IdentityUserSummary>> streams = new ArrayList<>();
        long totalElements = 0;
        for (List<UUID> chunk : chunks(candidates)) {
            List<IdentityUserSummary> stream = fetchCompleteChunk(
                    chunk, normalizedSearch, direction, comparator);
            streams.add(stream);
            totalElements = Math.addExact(totalElements, stream.size());
        }

        long offset = Math.multiplyExact((long) page, size);
        List<IdentityUserSummary> items = sliceMerged(streams, comparator, offset, size);
        int totalPages = totalElements == 0
                ? 0
                : Math.toIntExact((totalElements + size - 1) / size);
        return new PageResult<>(items, page, size, totalElements, totalPages);
    }

    @Override
    public List<IdentityUserSummary> getUsersByIds(Collection<UUID> userIds) {
        List<UUID> requested = normalizedIds(userIds, "userIds");
        if (requested.isEmpty()) {
            return List.of();
        }
        Map<UUID, IdentityUserSummary> summaries = new LinkedHashMap<>();
        for (List<UUID> chunk : chunks(requested)) {
            UserSummaryPayload[] payload = post(
                    "/internal/directory/users/batch",
                    new BatchRequest(chunk),
                    UserSummaryPayload[].class);
            if (payload == null) {
                throw new DependencyUnavailableException();
            }
            Set<UUID> chunkIds = Set.copyOf(chunk);
            for (UserSummaryPayload item : payload) {
                IdentityUserSummary summary = toSummary(item);
                if (!chunkIds.contains(summary.userId())) {
                    throw new DependencyUnavailableException();
                }
                summaries.put(summary.userId(), summary);
            }
        }
        return requested.stream()
                .map(summaries::get)
                .filter(Objects::nonNull)
                .toList();
    }

    private List<IdentityUserSummary> fetchCompleteChunk(
            List<UUID> chunk,
            String search,
            SortDirection direction,
            Comparator<IdentityUserSummary> comparator) {
        DirectoryPagePayload first = post(
                "/internal/directory/users/search",
                new DirectorySearchRequest(chunk, search, 0, IDENTITY_PAGE_SIZE, direction),
                DirectoryPagePayload.class);
        validatePagePayload(first, chunk, 0);
        List<IdentityUserSummary> all = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        addPage(first, all, chunk, seen);
        for (int page = 1; page < first.totalPages(); page++) {
            DirectoryPagePayload next = post(
                    "/internal/directory/users/search",
                    new DirectorySearchRequest(chunk, search, page, IDENTITY_PAGE_SIZE, direction),
                    DirectoryPagePayload.class);
            validatePagePayload(next, chunk, page);
            addPage(next, all, chunk, seen);
        }
        if (all.size() != first.totalElements()) {
            throw new DependencyUnavailableException();
        }
        all.sort(comparator);
        return List.copyOf(all);
    }

    private void validatePagePayload(
            DirectoryPagePayload payload,
            List<UUID> chunk,
            int expectedPage) {
        if (payload == null
                || payload.items() == null
                || payload.page() != expectedPage
                || payload.size() != IDENTITY_PAGE_SIZE
                || payload.totalElements() < 0
                || payload.totalElements() > chunk.size()
                || payload.totalPages() < 0
                || payload.totalPages() > (payload.totalElements() == 0
                ? 0
                : (payload.totalElements() + IDENTITY_PAGE_SIZE - 1) / IDENTITY_PAGE_SIZE)
                || payload.items().size() > IDENTITY_PAGE_SIZE
                || (payload.totalElements() == 0 && payload.totalPages() != 0)
                || (payload.totalElements() > 0 && payload.totalPages() == 0)) {
            throw new DependencyUnavailableException();
        }
    }

    private void addPage(
            DirectoryPagePayload page,
            List<IdentityUserSummary> all,
            List<UUID> chunk,
            Set<UUID> seen) {
        Set<UUID> chunkIds = Set.copyOf(chunk);
        for (UserSummaryPayload item : page.items()) {
            IdentityUserSummary summary = toSummary(item);
            if (!chunkIds.contains(summary.userId()) || !seen.add(summary.userId())) {
                throw new DependencyUnavailableException();
            }
            all.add(summary);
        }
    }

    private List<IdentityUserSummary> sliceMerged(
            List<List<IdentityUserSummary>> streams,
            Comparator<IdentityUserSummary> comparator,
            long offset,
            int size) {
        PriorityQueue<StreamCursor> queue = new PriorityQueue<>(
                Comparator.comparing(StreamCursor::current, comparator));
        for (List<IdentityUserSummary> stream : streams) {
            if (!stream.isEmpty()) {
                queue.add(new StreamCursor(stream));
            }
        }
        long index = 0;
        List<IdentityUserSummary> items = new ArrayList<>(size);
        long end = Math.addExact(offset, size);
        while (!queue.isEmpty()) {
            StreamCursor cursor = queue.poll();
            if (index >= offset && index < end) {
                items.add(cursor.current());
            }
            index++;
            if (cursor.advance()) {
                queue.add(cursor);
            }
            if (index >= end && end > 0) {
                break;
            }
        }
        return List.copyOf(items);
    }

    private Comparator<IdentityUserSummary> comparator(SortDirection direction) {
        return (left, right) -> {
            int result;
            if (left.displayName() == null && right.displayName() == null) {
                result = 0;
            } else if (left.displayName() == null) {
                result = 1;
            } else if (right.displayName() == null) {
                result = -1;
            } else {
                result = left.displayName().toLowerCase(Locale.ROOT)
                        .compareTo(right.displayName().toLowerCase(Locale.ROOT));
                if (direction == SortDirection.DESC) {
                    result = -result;
                }
            }
            return result != 0 ? result : left.userId().compareTo(right.userId());
        };
    }

    private <T> T post(String path, Object body, Class<T> responseType) {
        long started = System.nanoTime();
        try {
            return request(path)
                    .body(body)
                    .retrieve()
                    .body(responseType);
        } catch (RestClientResponseException exception) {
            RuntimeException mapped = mapResponseFailure(exception.getStatusCode());
            if (mapped instanceof DependencyUnavailableException) {
                logDependencyFailure(path, exception, started);
            }
            throw mapped;
        } catch (RestClientException exception) {
            logDependencyFailure(path, exception, started);
            throw new DependencyUnavailableException();
        }
    }

    private RestClient.RequestBodySpec request(String path) {
        RestClient.RequestBodySpec request = restClient.post()
                .uri(path)
                .header(INTERNAL_KEY_HEADER, requiredServiceKey());
        String requestId = RequestCorrelationFilter.currentRequestId();
        return requestId == null
                ? request
                : request.header(RequestCorrelationFilter.HEADER_NAME, requestId);
    }

    private void logDependencyFailure(String operation, RuntimeException exception, long started) {
        log.warn("event=identity_directory_failure requestId={} operation={} downstream=identity-service "
                        + "errorType={} latencyMs={}",
                RequestCorrelationFilter.currentRequestId(),
                operation,
                exception.getClass().getSimpleName(),
                Duration.ofNanos(Math.max(0L, System.nanoTime() - started)).toMillis());
    }

    private boolean isDependencyFailure(HttpStatusCode status) {
        int statusCode = status.value();
        return status.is5xxServerError()
                || statusCode == 401
                || statusCode == 403
                || statusCode == 404
                || statusCode == 429;
    }

    private RuntimeException mapResponseFailure(HttpStatusCode status) {
        int statusCode = status.value();
        if (status.is5xxServerError()
                || statusCode == 401
                || statusCode == 403
                || statusCode == 404
                || statusCode == 429) {
            return new DependencyUnavailableException();
        }
        if (status.is4xxClientError()) {
            return new BadRequestException("Identity directory request was rejected");
        }
        return new DependencyUnavailableException();
    }

    private IdentityUserSummary toSummary(UserSummaryPayload payload) {
        if (payload == null || payload.userId() == null || payload.email() == null) {
            throw new DependencyUnavailableException();
        }
        return new IdentityUserSummary(
                payload.userId(), payload.email(), payload.displayName(), payload.active());
    }

    private String requiredServiceKey() {
        if (!properties.hasServiceKey()) {
            throw new DependencyUnavailableException();
        }
        return properties.internalServiceKey();
    }

    private List<UUID> normalizedIds(Collection<UUID> ids, String name) {
        if (ids == null) {
            throw new BadRequestException(name + " must not be null");
        }
        LinkedHashSet<UUID> unique = new LinkedHashSet<>();
        for (UUID id : ids) {
            if (id == null) {
                throw new BadRequestException(name + " must not contain null IDs");
            }
            unique.add(id);
        }
        return List.copyOf(unique);
    }

    private List<List<UUID>> chunks(List<UUID> ids) {
        List<List<UUID>> chunks = new ArrayList<>();
        for (int from = 0; from < ids.size(); from += MAX_TRANSPORT_IDS) {
            chunks.add(List.copyOf(ids.subList(from, Math.min(ids.size(), from + MAX_TRANSPORT_IDS))));
        }
        return chunks;
    }

    private String normalizeEmail(String email) {
        return IdentityEmailNormalizer.canonicalize(email);
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

    private void validatePage(int page, int size, SortDirection direction) {
        if (page < 0) {
            throw new BadRequestException("page must not be negative");
        }
        if (size < 1 || size > IDENTITY_PAGE_SIZE) {
            throw new BadRequestException("size must be between 1 and " + IDENTITY_PAGE_SIZE);
        }
        if (direction == null) {
            throw new BadRequestException("direction must not be null");
        }
    }

    private <T> T requirePayload(T payload) {
        if (payload == null) {
            throw new DependencyUnavailableException();
        }
        return payload;
    }

    private record EmailLookupRequest(String email) {}

    private record CandidateMatchRequest(List<UUID> candidateUserIds, String search) {}

    private record DirectorySearchRequest(
            List<UUID> candidateUserIds,
            String search,
            int page,
            int size,
            String direction,
            String sort) {
        private DirectorySearchRequest(
                List<UUID> candidateUserIds,
                String search,
                int page,
                int size,
                SortDirection direction) {
            this(candidateUserIds, search, page, size,
                    direction == SortDirection.DESC ? "desc" : "asc",
                    "displayName");
        }
    }

    private record BatchRequest(List<UUID> userIds) {}

    private record MatchingIdsPayload(Set<UUID> matchingUserIds) {}

    private record UserSummaryPayload(
            UUID userId,
            String email,
            String displayName,
            boolean active) {}

    private record DirectoryPagePayload(
            List<UserSummaryPayload> items,
            int page,
            int size,
            long totalElements,
            int totalPages) {}

    private static final class StreamCursor {
        private final List<IdentityUserSummary> stream;
        private int index;

        private StreamCursor(List<IdentityUserSummary> stream) {
            this.stream = stream;
        }

        private IdentityUserSummary current() {
            return stream.get(index);
        }

        private boolean advance() {
            index++;
            return index < stream.size();
        }
    }
}
