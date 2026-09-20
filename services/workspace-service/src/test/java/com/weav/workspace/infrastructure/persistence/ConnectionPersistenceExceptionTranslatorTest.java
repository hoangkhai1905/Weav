package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.domain.exception.ConnectionNameAlreadyExistsException;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectionPersistenceExceptionTranslatorTest {

    @Test
    void translatesTheTypedNormalizedNameConstraintThroughSpringWrapper() {
        ConstraintViolationException violation = new ConstraintViolationException(
                "database constraint failure",
                new SQLException("database constraint failure"),
                ConnectionPersistenceExceptionTranslator.CONNECTION_NAME_UNIQUE_INDEX);
        DataIntegrityViolationException wrapped = new DataIntegrityViolationException(
                "persistence failure",
                violation);

        assertThat(ConnectionPersistenceExceptionTranslator.translate(wrapped))
                .isInstanceOf(ConnectionNameAlreadyExistsException.class);
    }

    @Test
    void doesNotTranslateTextThatOnlyMentionsTheIndex() {
        DataIntegrityViolationException exception = new DataIntegrityViolationException(
                "unrelated message mentions "
                        + ConnectionPersistenceExceptionTranslator.CONNECTION_NAME_UNIQUE_INDEX);

        assertThat(ConnectionPersistenceExceptionTranslator.translate(exception))
                .isSameAs(exception);
    }

    @Test
    void doesNotTranslateAnUnrelatedTypedConstraint() {
        ConstraintViolationException violation = new ConstraintViolationException(
                "database constraint failure",
                new SQLException("database constraint failure"),
                "some_other_constraint");

        assertThat(ConnectionPersistenceExceptionTranslator.translate(violation))
                .isSameAs(violation);
    }
}
