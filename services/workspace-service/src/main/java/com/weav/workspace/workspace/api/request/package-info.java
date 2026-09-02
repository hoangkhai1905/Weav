/**
 * HTTP request DTOs for the workspace feature.
 *
 * <p>Request DTOs in this package use immutable Java records, Bean Validation
 * annotations on record components, and remain separate from JPA entities and
 * response DTOs. Nested request objects are validated at the controller boundary
 * with {@code @Valid}; method and path/query parameter constraints use
 * {@code @Validated}.
 */
package com.weav.workspace.workspace.api.request;