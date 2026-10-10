import { NODE_SCHEMAS } from './nodeSchemas';

/** Node type -> i18n name key; the same keys the builder palette uses. */
export const NODE_NAME_KEYS: Record<string, string> = {
  'trigger.manual': 'builder.node.manual',
  'trigger.schedule': 'builder.node.schedule',
  'trigger.webhook': 'builder.node.webhook',
  'trigger.telegram': 'builder.node.telegram_trigger',
  'trigger.gmail': 'builder.node.gmail_trigger',
  'http.request': 'builder.node.http',
  'email.send': 'builder.node.email',
  'google.sheets': 'builder.node.google_sheets',
  'google.drive': 'builder.node.google_drive',
  'google.calendar': 'builder.node.google_calendar',
  'telegram.send_message': 'builder.node.telegram_send',
  'logic.condition': 'builder.node.condition',
  'logic.switch': 'builder.node.switch',
  'data.set': 'builder.node.data_set',
  'ai.extract': 'builder.node.ai_extract',
  'ai.classify': 'builder.node.ai_classify',
  'ai.summarize': 'builder.node.ai_summarize',
  'ai.generate': 'builder.node.ai_generate',
  'ocr.extract': 'builder.node.ocr',
  'trigger.workflow_event': 'builder.node.workflow_event',
  'discord.send_message': 'builder.node.discord_send',
  'slack.send_message': 'builder.node.slack_send',
  'teams.send_message': 'builder.node.teams_send',
  'format.datetime': 'builder.node.format_datetime',
  'format.text': 'builder.node.format_text',
  'weav.workflow': 'builder.node.weav_workflow',
};

/** Localized node label; falls back to the schema title, then the raw type. */
export const nodeLabel = (type: string, t: (key: string) => string): string => {
  const key = NODE_NAME_KEYS[type];
  return key ? t(key) : NODE_SCHEMAS[type]?.title ?? type;
};
