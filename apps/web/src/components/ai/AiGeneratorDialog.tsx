import { AiGeneratorPage } from '../../pages/AiGeneratorPage';
import { TemplateDialog } from '../templates/TemplateDialog';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';

/** "Create with AI" as a dialog over the current page, opened through `useUIStore().openAiGenerator`. */
export function AiGeneratorDialog() {
  const { t } = useI18nStore();
  const open = useUIStore((state) => state.aiGeneratorOpen);
  const prompt = useUIStore((state) => state.aiPrompt);
  const close = useUIStore((state) => state.closeAiGenerator);
  if (!open) return null;
  return (
    <TemplateDialog wide title={t('ai_gen.title')} onClose={close} testId="ai-generator-dialog">
      <AiGeneratorPage inDialog initialPrompt={prompt} />
    </TemplateDialog>
  );
}
