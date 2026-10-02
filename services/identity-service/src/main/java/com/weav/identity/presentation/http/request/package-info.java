/**
 * HTTP request DTOs for the user feature.
 *
 * <p>Request DTOs in this package follow these conventions:
 * <ul>
 *     <li>Use immutable Java records.</li>
 *     <li>Put Bean Validation annotations on record components.</li>
 *     <li>Keep request DTOs separate from JPA entities and response DTOs.</li>
 *     <li>Apply {@code @Valid} at the controller boundary for nested DTOs.</li>
 *     <li>Use {@code @Validated} for method and path/query parameter constraints.</li>
 * </ul>
 */
package com.weav.identity.presentation.http.request;
