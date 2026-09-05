package com.weav.workflow.presentation.http.request;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

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
        CreateWorkflowRequest request = new CreateWorkflowRequest(
                "",
                null,
                "",
                new JsonMapper().readTree("{}"),
                null
        );

        Set<ConstraintViolation<CreateWorkflowRequest>> violations = validator.validate(request);

        assertEquals(2, violations.size());
        assertTrue(violations.stream().anyMatch(v -> v.getPropertyPath().toString().equals("name")));
        assertTrue(violations.stream().anyMatch(v -> v.getPropertyPath().toString().equals("schemaVersion")));
    }

    @Test
    void acceptsValidWorkflowRequest() throws Exception {
        CreateWorkflowRequest request = new CreateWorkflowRequest(
                "Invoice Workflow",
                "Processes invoices",
                "1.0",
                new JsonMapper().readTree("{\"nodes\":[],\"edges\":[]}"),
                new JsonMapper().readTree("{\"viewport\":{\"zoom\":1}}")
        );

        assertTrue(validator.validate(request).isEmpty());
    }
}
