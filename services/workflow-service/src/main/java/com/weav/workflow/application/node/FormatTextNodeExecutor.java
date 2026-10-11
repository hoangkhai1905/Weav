package com.weav.workflow.application.node;

import com.weav.workflow.domain.definition.JsonValues;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Pure text helper: case, trim, replace (literal), split, join, truncate and number formatting. */
@Component
public final class FormatTextNodeExecutor implements NodeExecutor {

    private static final String TYPE = "format.text";
    private static final Set<String> OPERATIONS = Set.of(
            "upper", "lower", "trim", "replace", "split", "join", "truncate", "number_format");
    private static final int MAX_TEXT = 100_000;
    private static final int MAX_RESULT = 1_000_000;
    private static final int MAX_SEPARATOR = 16;
    private static final int MAX_SPLIT_ITEMS = 1_000;
    private static final int MAX_INTEGER_DIGITS = 30;
    private static final int MAX_SCALE = 10_000;
    private static final int MAX_NUMBER_TEXT = 64;

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Result execute(Context context, Map<String, Object> config) {
        if (config == null) {
            throw Failure.invalidField("operation", "is required.");
        }
        String operation = config.get("operation") instanceof String text ? text.strip() : "";
        if (!OPERATIONS.contains(operation)) {
            throw Failure.invalidField("operation", "must be upper, lower, trim, replace, split, join, "
                    + "truncate or number_format.");
        }
        Object raw = config.get("value");
        if ("join".equals(operation)) {
            return single(join(raw, separator(config.get("separator"))));
        }
        if ("number_format".equals(operation)) {
            return single(numberFormat(raw, config.get("decimals"), config.get("locale")));
        }
        String value = text(raw);
        return switch (operation) {
            case "upper" -> single(value.toUpperCase(Locale.ROOT));
            case "lower" -> single(value.toLowerCase(Locale.ROOT));
            case "trim" -> single(value.strip());
            case "replace" -> single(replace(value, config.get("search"), config.get("replacement")));
            case "split" -> new Result(Map.of("value", split(value, separator(config.get("separator")))), null);
            default -> single(truncate(value, config.get("maxLength")));
        };
    }

    private static Result single(String value) {
        return new Result(Map.of("value", value), null);
    }

    private static String text(Object value) {
        String text = value instanceof String s ? s : value instanceof Number || value instanceof Boolean
                ? JsonValues.scalarText(value) : null;
        if (text == null) {
            throw Failure.invalidField("value", "must be text.");
        }
        if (text.length() > MAX_TEXT) {
            throw Failure.invalidField("value", "must be at most 100000 characters.");
        }
        return text;
    }

    private static String separator(Object value) {
        if (value == null) {
            return ",";
        }
        if (!(value instanceof String text) || text.isEmpty() || text.length() > MAX_SEPARATOR) {
            throw Failure.invalidField("separator", "must be 1 to 16 characters.");
        }
        return text;
    }

    private static String replace(String value, Object search, Object replacement) {
        if (!(search instanceof String find) || find.isEmpty() || find.length() > 1000) {
            throw Failure.invalidField("search", "is required and must be at most 1000 characters.");
        }
        if (replacement != null && !(replacement instanceof String)) {
            throw Failure.invalidField("replacement", "must be text.");
        }
        String with = replacement == null ? "" : (String) replacement;
        long growth = Math.max(0, with.length() - find.length());
        if (with.length() > 1000 || value.length() + (long) (value.length() / find.length()) * growth > MAX_RESULT) {
            throw Failure.invalidField("replacement", "would make the result too long.");
        }
        return value.replace(find, with);
    }

    private static List<String> split(String value, String separator) {
        List<String> parts = new ArrayList<>();
        int start = 0;
        for (int next; (next = value.indexOf(separator, start)) >= 0; start = next + separator.length()) {
            parts.add(value.substring(start, next));
            if (parts.size() >= MAX_SPLIT_ITEMS) {
                throw new Failure("FORMAT_RESULT_TOO_LARGE", "Splitting would give more than 1000 items.", false);
            }
        }
        parts.add(value.substring(start));
        return parts;
    }

    private static String join(Object value, String separator) {
        if (!(value instanceof List<?> items)) {
            throw Failure.invalidField("value", "must be a list for join.");
        }
        StringBuilder out = new StringBuilder();
        boolean first = true;
        for (Object item : items) {
            String part = JsonValues.scalarText(item);
            if (part == null) {
                throw Failure.invalidField("value", "must be a list of texts or numbers.");
            }
            if (out.length() + separator.length() + part.length() > MAX_RESULT) {
                throw new Failure("FORMAT_RESULT_TOO_LARGE", "The joined text is too long.", false);
            }
            out.append(first ? "" : separator).append(part);
            first = false;
        }
        return out.toString();
    }

    private static String truncate(String value, Object maxLength) {
        BigDecimal limit = maxLength instanceof Number n ? new BigDecimal(n.toString())
                : maxLength instanceof String s && !s.isBlank() ? parse(s.strip()) : null;
        if (limit == null || limit.stripTrailingZeros().scale() > 0
                || limit.compareTo(BigDecimal.ONE) < 0 || limit.compareTo(BigDecimal.valueOf(MAX_TEXT)) > 0) {
            throw Failure.invalidField("maxLength", "must be a whole number from 1 to 100000.");
        }
        int max = limit.intValue();
        return value.codePointCount(0, value.length()) <= max ? value : value.substring(0, value.offsetByCodePoints(0, max));
    }

    private static BigDecimal parse(String text) {
        try {
            return new BigDecimal(text);
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private static String numberFormat(Object value, Object decimalsValue, Object localeValue) {
        BigDecimal number = value instanceof Number n ? parse(n.toString())
                : value instanceof String s && !s.isBlank() && s.strip().length() <= MAX_NUMBER_TEXT
                ? parse(s.strip()) : null;
        if (number == null || Math.abs((long) number.scale()) > MAX_SCALE
                || (long) number.precision() - number.scale() > MAX_INTEGER_DIGITS) {
            throw new Failure("FORMAT_INVALID_NUMBER", "The value is not a number.", false);
        }
        BigDecimal decimals = decimalsValue == null ? BigDecimal.ZERO
                : decimalsValue instanceof Number n ? new BigDecimal(n.toString())
                : decimalsValue instanceof String s && !s.isBlank() ? parse(s.strip()) : null;
        if (decimals == null || decimals.stripTrailingZeros().scale() > 0
                || decimals.compareTo(BigDecimal.ZERO) < 0 || decimals.compareTo(BigDecimal.valueOf(6)) > 0) {
            throw Failure.invalidField("decimals", "must be a whole number from 0 to 6.");
        }
        String locale = localeValue == null || localeValue instanceof String l && l.isBlank() ? "vi"
                : localeValue instanceof String l ? l.strip() : "";
        if (!locale.equals("vi") && !locale.equals("en")) {
            throw Failure.invalidField("locale", "must be vi or en.");
        }
        int digits = decimals.intValue();
        DecimalFormatSymbols symbols = new DecimalFormatSymbols(Locale.ROOT);
        symbols.setGroupingSeparator("vi".equals(locale) ? '.' : ',');
        symbols.setDecimalSeparator("vi".equals(locale) ? ',' : '.');
        DecimalFormat format = new DecimalFormat(digits == 0 ? "#,##0" : "#,##0." + "0".repeat(digits), symbols);
        format.setRoundingMode(RoundingMode.HALF_UP);
        return format.format(number.setScale(digits, RoundingMode.HALF_UP));
    }
}
