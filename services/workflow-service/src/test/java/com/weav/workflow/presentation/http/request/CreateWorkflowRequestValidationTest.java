package com.weav.workflow.presentation.http.request;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CreateWorkflowRequestValidationTest {

    private static Validator validator;
    private static ValidatorFactory validatorFactory;

    @BeforeAll
    static void setUpValidator() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    @AfterAll
    static void closeValidator() {
        validatorFactory.close();
    }

    @Test
    void rejectsInvalidWorkflowRequest() throws Exception {
        CreateWorkflowRequest request = new CreateWorkflowRequest("", null);

        Set<ConstraintViolation<CreateWorkflowRequest>> violations = validator.validate(request);

        assertEquals(1, violations.size());
        assertTrue(violations.stream().anyMatch(v -> v.getPropertyPath().toString().equals("name")));
    }

    @Test
    void acceptsValidWorkflowRequest() throws Exception {
        CreateWorkflowRequest request = new CreateWorkflowRequest("Invoice Workflow", "Processes invoices");

        assertTrue(validator.validate(request).isEmpty());
    }
}
