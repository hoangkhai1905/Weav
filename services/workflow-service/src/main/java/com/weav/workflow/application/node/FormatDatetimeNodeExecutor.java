package com.weav.workflow.application.node;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure date-time helper: now, add, subtract, format and convert. It calls nothing outside Weav. Without an explicit
 * {@code timezone} a value that carries an offset keeps it; a local date-time, a date or epoch milliseconds use UTC.
 */
@Component
public final class FormatDatetimeNodeExecutor implements NodeExecutor {

    private static final String TYPE = "format.datetime";
    private static final Set<String> OPERATIONS = Set.of("now", "add", "subtract", "format", "convert");
    private static final Map<String, ChronoUnit> UNITS = Map.of(
            "minutes", ChronoUnit.MINUTES, "hours", ChronoUnit.HOURS, "days", ChronoUnit.DAYS,
            "weeks", ChronoUnit.WEEKS, "months", ChronoUnit.MONTHS, "years", ChronoUnit.YEARS);
    private static final Pattern EPOCH_MILLIS = Pattern.compile("-?\\d{1,15}");
    private static final long MAX_AMOUNT = 100_000;
    private static final int MAX_PATTERN = 64;

    private final Clock clock;

    public FormatDatetimeNodeExecutor() {
        this(Clock.systemUTC());
    }

    FormatDatetimeNodeExecutor(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

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
            throw Failure.invalidField("operation", "must be now, add, subtract, format or convert.");
        }
        ZoneId zone = zone(config.get("timezone"));
        ZonedDateTime base = "now".equals(operation)
                ? ZonedDateTime.now(clock).withZoneSameInstant(zone == null ? ZoneOffset.UTC : zone)
                : parse(config.get("value"), zone);
        ZonedDateTime result = base;
        String formatted = null;
        String iso;
        long epochMs;
        try {
            switch (operation) {
                case "add", "subtract" -> {
                    long amount = amount(config.get("amount"));
                    result = base.plus("add".equals(operation) ? amount : -amount, unit(config.get("unit")));
                }
                case "format" -> formatted = format(base, config.get("pattern"), config.get("locale"));
                case "convert" -> {
                    if (zone == null) {
                        throw Failure.invalidField("timezone", "is required.");
                    }
                }
                default -> {
                }
            }
            iso = result.truncatedTo(ChronoUnit.MILLIS).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
            epochMs = result.toInstant().toEpochMilli();
        } catch (DateTimeException | ArithmeticException exception) {
            throw new Failure("FORMAT_INVALID_DATETIME", "The date-time is out of the supported range.", false);
        }
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("value", formatted == null ? iso : formatted);
        output.put("iso", iso);
        output.put("epochMs", epochMs);
        return new Result(output, null);
    }

    private static ZoneId zone(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) {
            return null;
        }
        try {
            return ZoneId.of(value instanceof String text ? text.strip() : "");
        } catch (DateTimeException exception) {
            throw Failure.invalidField("timezone", "must be an IANA time zone such as Asia/Ho_Chi_Minh.");
        }
    }

    private static ZonedDateTime parse(Object value, ZoneId zone) {
        ZoneId local = zone == null ? ZoneOffset.UTC : zone;
        try {
            ZonedDateTime parsed;
            if (value instanceof Number number && !(number instanceof Double) && !(number instanceof Float)) {
                parsed = java.time.Instant.ofEpochMilli(new BigDecimal(number.toString()).longValueExact()).atZone(local);
            } else if (value instanceof String raw && !raw.isBlank()) {
                String text = raw.strip();
                if (EPOCH_MILLIS.matcher(text).matches()) {
                    parsed = java.time.Instant.ofEpochMilli(Long.parseLong(text)).atZone(local);
                } else if (text.length() <= 10) {
                    parsed = LocalDate.parse(text).atStartOfDay(local);
                } else {
                    var best = DateTimeFormatter.ISO_DATE_TIME.parseBest(text, ZonedDateTime::from, LocalDateTime::from);
                    parsed = best instanceof ZonedDateTime zoned ? zoned : ((LocalDateTime) best).atZone(local);
                }
            } else {
                throw new Failure("FORMAT_INVALID_DATETIME", "The value is not a valid date-time.", false);
            }
            return zone == null ? parsed : parsed.withZoneSameInstant(zone);
        } catch (DateTimeException | ArithmeticException | NumberFormatException exception) {
            throw new Failure("FORMAT_INVALID_DATETIME", "The value is not a valid date-time.", false);
        }
    }

    private static long amount(Object value) {
        try {
            BigDecimal number = value instanceof Number n ? new BigDecimal(n.toString())
                    : value instanceof String text ? new BigDecimal(text.strip()) : null;
            if (number != null && number.abs().compareTo(BigDecimal.valueOf(MAX_AMOUNT)) <= 0) {
                return number.longValueExact();
            }
        } catch (ArithmeticException | NumberFormatException exception) {
            // falls through to the configuration error
        }
        throw Failure.invalidField("amount", "must be a whole number from -100000 to 100000.");
    }

    private static ChronoUnit unit(Object value) {
        ChronoUnit unit = value instanceof String text ? UNITS.get(text.strip()) : null;
        if (unit == null) {
            throw Failure.invalidField("unit", "must be minutes, hours, days, weeks, months or years.");
        }
        return unit;
    }

    private static String format(ZonedDateTime time, Object pattern, Object locale) {
        if (!(pattern instanceof String text) || text.isBlank() || text.length() > MAX_PATTERN) {
            throw Failure.invalidField("pattern", "is required and must be at most 64 characters.");
        }
        String language = locale == null || locale instanceof String l && l.isBlank() ? "vi"
                : locale instanceof String l ? l.strip() : "";
        if (!language.equals("vi") && !language.equals("en")) {
            throw Failure.invalidField("locale", "must be vi or en.");
        }
        try {
            return DateTimeFormatter.ofPattern(text, Locale.forLanguageTag(language)).format(time);
        } catch (IllegalArgumentException | DateTimeException exception) {
            throw Failure.forField("FORMAT_INVALID_PATTERN", "pattern", "The date-time pattern is not valid.");
        }
    }
}
