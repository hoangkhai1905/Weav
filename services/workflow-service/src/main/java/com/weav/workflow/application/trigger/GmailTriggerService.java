package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.GmailTriggerPort;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Bounded scan of due Gmail triggers; each trigger is polled independently. */
@Service
public class GmailTriggerService {
    private static final Logger logger = LoggerFactory.getLogger(GmailTriggerService.class);

    private final GmailTriggerPort triggers;
    private final GmailTriggerProcessor processor;

    public GmailTriggerService(GmailTriggerPort triggers, GmailTriggerProcessor processor) {
        this.triggers = Objects.requireNonNull(triggers);
        this.processor = Objects.requireNonNull(processor);
    }

    public ScanResult scan(Instant scanTime, int batchSize) {
        Objects.requireNonNull(scanTime, "scanTime must not be null");
        List<GmailTriggerPort.Candidate> due = triggers.findDueGmail(scanTime, batchSize);
        int admitted = 0;
        int failed = 0;
        for (GmailTriggerPort.Candidate candidate : due) {
            try {
                admitted += processor.poll(candidate, scanTime);
            } catch (RuntimeException exception) {
                failed++;
                logger.warn("event=gmail_poll_error triggerId={} errorType={}", candidate.triggerId(),
                        exception.getClass().getSimpleName());
            }
        }
        return new ScanResult(due.size(), admitted, failed);
    }

    public record ScanResult(int selected, int admitted, int failed) {
    }
}
