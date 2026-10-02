package com.weav.workflow.domain.execution;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** Evaluates the six declarative Workflow V1 predicate operators without executing user code. */
public final class ConditionEvaluator {
    public boolean evaluate(Object left, String operator, Object right) {
        if (operator == null) {
            throw new IllegalArgumentException("A condition operator is required.");
        }
        return switch (operator) {
            case "eq" -> structurallyEqual(left, right);
            case "ne" -> !structurallyEqual(left, right);
            case "gt" -> compareNumbers(left, right) > 0;
            case "gte" -> compareNumbers(left, right) >= 0;
            case "lt" -> compareNumbers(left, right) < 0;
            case "lte" -> compareNumbers(left, right) <= 0;
            default -> throw new IllegalArgumentException("The condition operator is not supported.");
        };
    }

    private boolean structurallyEqual(Object left, Object right) {
        if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
            return decimalValue(leftNumber).compareTo(decimalValue(rightNumber)) == 0;
        }
        if (left instanceof Map<?, ?> leftObject && right instanceof Map<?, ?> rightObject) {
            if (leftObject.size() != rightObject.size()) {
                return false;
            }
            for (Map.Entry<?, ?> entry : leftObject.entrySet()) {
                if (!rightObject.containsKey(entry.getKey())
                        || !structurallyEqual(entry.getValue(), rightObject.get(entry.getKey()))) {
                    return false;
                }
            }
            return true;
        }
        if (left instanceof List<?> leftArray && right instanceof List<?> rightArray) {
            if (leftArray.size() != rightArray.size()) {
                return false;
            }
            for (int index = 0; index < leftArray.size(); index++) {
                if (!structurallyEqual(leftArray.get(index), rightArray.get(index))) {
                    return false;
                }
            }
            return true;
        }
        return left == null ? right == null : left.equals(right);
    }

    private int compareNumbers(Object left, Object right) {
        if (!(left instanceof Number leftNumber) || !(right instanceof Number rightNumber)) {
            throw new IllegalArgumentException("Ordering conditions require numeric operands.");
        }
        return decimalValue(leftNumber).compareTo(decimalValue(rightNumber));
    }

    private BigDecimal decimalValue(Number value) {
        try {
            return new BigDecimal(value.toString());
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Condition numbers must be finite JSON numbers.");
        }
    }
}
