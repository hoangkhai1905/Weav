// Ready-made workflows for "Dùng mẫu". Static definitions that use only existing node types.
// connectionId is left out on purpose: the user picks connections in the builder after creating the draft.
// Output keys follow the executors: data.set returns its fields at the top level, sheets lookup returns
// { range, rows, count, truncated }, ai.summarize returns { summary }, drive upload returns { id, name, ... }.

export type TemplateCategory = 'chat' | 'google' | 'ai';

export interface TemplateNode {
  id: string;
  type: string;
  /** Vietnamese display name shown on the canvas. */
  name: string;
  config: Record<string, unknown>;
}

export interface TemplateEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: 'true' | 'false';
}

export interface WorkflowTemplate {
  id: string;
  category: TemplateCategory;
  vi: { name: string; description: string };
  en: { name: string; description: string };
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

const chain = (...ids: string[]): TemplateEdge[] =>
  ids.slice(1).map((target, index) => ({ id: `edge_${index + 1}`, source: ids[index], target }));

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'telegram-auto-reply',
    category: 'chat',
    vi: {
      name: 'Bot Telegram tự động trả lời',
      description: 'Khi bot nhận được tin nhắn, tự động trả lời lại ngay trong cuộc trò chuyện đó.',
    },
    en: {
      name: 'Telegram auto-reply bot',
      description: 'When the bot receives a message, it replies in the same chat.',
    },
    nodes: [
      { id: 'telegram_trigger', type: 'trigger.telegram', name: 'Nhận tin nhắn Telegram', config: {} },
      {
        id: 'send_reply',
        type: 'telegram.send_message',
        name: 'Trả lời tin nhắn',
        config: {
          chatId: '{{ trigger.input.message.chat.id }}',
          text: 'Weav đã nhận tin nhắn của bạn: {{ trigger.input.message.text }}',
          replyToMessageId: '{{ trigger.input.message.messageId }}',
        },
      },
    ],
    edges: chain('telegram_trigger', 'send_reply'),
  },
  {
    id: 'gmail-attachment-to-drive',
    category: 'google',
    vi: {
      name: 'Lưu tệp đính kèm Gmail vào Drive và trả lời',
      description: 'Với mỗi email có tệp đính kèm, lưu tệp đầu tiên vào Google Drive rồi trả lời người gửi trong cùng cuộc hội thoại.',
    },
    en: {
      name: 'Save Gmail attachment to Drive and reply',
      description: 'For each email with an attachment, save the first file to Google Drive and reply in the same thread.',
    },
    nodes: [
      {
        id: 'gmail_trigger',
        type: 'trigger.gmail',
        name: 'Email mới có tệp đính kèm',
        config: { query: 'has:attachment', pollIntervalMinutes: 5 },
      },
      {
        id: 'save_to_drive',
        type: 'google.drive',
        name: 'Lưu vào Google Drive',
        config: { operation: 'upload', file: '{{ trigger.input.attachments[0] }}' },
      },
      {
        id: 'reply_email',
        type: 'email.send',
        name: 'Trả lời người gửi',
        config: {
          to: '{{ trigger.input.fromEmail }}',
          subject: 'Re: {{ trigger.input.subject }}',
          body: 'Cảm ơn bạn. Weav đã lưu tệp "{{ nodes.save_to_drive.output.name }}" vào Google Drive.',
          replyToMessageId: '{{ trigger.input.messageId }}',
        },
      },
    ],
    edges: chain('gmail_trigger', 'save_to_drive', 'reply_email'),
  },
  {
    id: 'webhook-to-sheets',
    category: 'google',
    vi: {
      name: 'Webhook ghi dòng mới vào Google Sheets',
      description: 'Nhận dữ liệu từ biểu mẫu hoặc ứng dụng khác qua webhook và thêm thành một dòng mới trong bảng tính.',
    },
    en: {
      name: 'Webhook appends a row to Google Sheets',
      description: 'Receive data from a form or app through a webhook and append it as a new spreadsheet row.',
    },
    nodes: [
      { id: 'webhook_trigger', type: 'trigger.webhook', name: 'Nhận webhook', config: {} },
      {
        id: 'append_row',
        type: 'google.sheets',
        name: 'Thêm dòng vào Sheets',
        config: {
          operation: 'append',
          range: 'A:C',
          values: [['{{ trigger.input.name }}', '{{ trigger.input.email }}', '{{ trigger.input.message }}']],
        },
      },
    ],
    edges: chain('webhook_trigger', 'append_row'),
  },
  {
    id: 'schedule-fetch-telegram',
    category: 'chat',
    vi: {
      name: 'Báo cáo định kỳ qua Telegram',
      description: 'Mỗi sáng 9 giờ, gọi một địa chỉ HTTP lấy dữ liệu rồi gửi kết quả vào Telegram.',
    },
    en: {
      name: 'Scheduled report to Telegram',
      description: 'Every morning at 9:00, fetch data from an HTTP address and send the result to Telegram.',
    },
    nodes: [
      {
        id: 'schedule_trigger',
        type: 'trigger.schedule',
        name: 'Chạy lúc 9 giờ sáng',
        config: { cron: '0 0 9 * * *', timezone: 'Asia/Ho_Chi_Minh' },
      },
      {
        id: 'fetch_data',
        type: 'http.request',
        name: 'Lấy dữ liệu',
        config: { method: 'GET', url: 'https://wttr.in/Hanoi?format=3' },
      },
      {
        id: 'send_report',
        type: 'telegram.send_message',
        name: 'Gửi báo cáo Telegram',
        config: { text: 'Báo cáo 9 giờ sáng: {{ nodes.fetch_data.output.data }}' },
      },
    ],
    edges: chain('schedule_trigger', 'fetch_data', 'send_report'),
  },
  {
    id: 'sheets-lookup-email',
    category: 'google',
    vi: {
      name: 'Tra cứu Google Sheets và gửi email',
      description: 'Nhận mã qua webhook, tra trong bảng tính, nếu tìm thấy thì gửi kết quả cho người yêu cầu.',
    },
    en: {
      name: 'Look up Google Sheets and send an email',
      description: 'Receive a code through a webhook, look it up in a spreadsheet and email the result if it is found.',
    },
    nodes: [
      { id: 'webhook_trigger', type: 'trigger.webhook', name: 'Nhận yêu cầu tra cứu', config: {} },
      {
        id: 'lookup_row',
        type: 'google.sheets',
        name: 'Tra cứu trong Sheets',
        config: {
          operation: 'lookup',
          range: 'A:D',
          lookupColumn: 'A',
          lookupValue: '{{ trigger.input.code }}',
          limit: 1,
        },
      },
      {
        id: 'found_check',
        type: 'logic.condition',
        name: 'Có kết quả?',
        config: { left: '{{ nodes.lookup_row.output.count }}', operator: 'gt', right: 0 },
      },
      {
        id: 'send_result',
        type: 'email.send',
        name: 'Gửi kết quả qua email',
        config: {
          to: '{{ trigger.input.email }}',
          subject: 'Kết quả tra cứu mã {{ trigger.input.code }}',
          body: 'Tìm thấy {{ nodes.lookup_row.output.count }} dòng cho mã {{ trigger.input.code }}. Giá trị cột đầu tiên: {{ nodes.lookup_row.output.rows[0].values[0] }}',
        },
      },
    ],
    edges: [
      { id: 'edge_1', source: 'webhook_trigger', target: 'lookup_row' },
      { id: 'edge_2', source: 'lookup_row', target: 'found_check' },
      { id: 'edge_3', source: 'found_check', target: 'send_result', sourcePort: 'true' },
    ],
  },
  {
    id: 'gmail-ai-summary-telegram',
    category: 'ai',
    vi: {
      name: 'AI tóm tắt email Gmail gửi qua Telegram',
      description: 'Với mỗi email mới, AI tóm tắt nội dung và gửi bản tóm tắt vào Telegram của bạn.',
    },
    en: {
      name: 'AI summary of Gmail sent to Telegram',
      description: 'For each new email, AI summarizes it and sends the summary to your Telegram.',
    },
    nodes: [
      { id: 'gmail_trigger', type: 'trigger.gmail', name: 'Email mới', config: { pollIntervalMinutes: 5 } },
      {
        id: 'summarize_email',
        type: 'ai.summarize',
        name: 'AI tóm tắt email',
        config: { inputText: '{{ trigger.input.body }}', maxLength: 300 },
      },
      {
        id: 'notify_telegram',
        type: 'telegram.send_message',
        name: 'Gửi tóm tắt qua Telegram',
        config: { text: 'Email từ {{ trigger.input.fromEmail }}: {{ nodes.summarize_email.output.summary }}' },
      },
    ],
    edges: chain('gmail_trigger', 'summarize_email', 'notify_telegram'),
  },
  {
    id: 'webhook-to-calendar',
    category: 'google',
    vi: {
      name: 'Webhook tạo sự kiện Google Calendar',
      description: 'Nhận tiêu đề, giờ bắt đầu và giờ kết thúc qua webhook rồi tạo sự kiện trong lịch.',
    },
    en: {
      name: 'Webhook creates a Google Calendar event',
      description: 'Receive a title, start and end time through a webhook and create a calendar event.',
    },
    nodes: [
      { id: 'webhook_trigger', type: 'trigger.webhook', name: 'Nhận webhook', config: {} },
      {
        id: 'create_event',
        type: 'google.calendar',
        name: 'Tạo sự kiện',
        config: {
          operation: 'create',
          summary: '{{ trigger.input.title }}',
          start: '{{ trigger.input.start }}',
          end: '{{ trigger.input.end }}',
          timeZone: 'Asia/Ho_Chi_Minh',
        },
      },
    ],
    edges: chain('webhook_trigger', 'create_event'),
  },
  {
    id: 'manual-http-email',
    category: 'chat',
    vi: {
      name: 'Gọi HTTP, đóng gói dữ liệu và gửi email',
      description: 'Bấm chạy thủ công: gọi một địa chỉ HTTP, gom kết quả bằng "Đặt dữ liệu" rồi gửi email.',
    },
    en: {
      name: 'Call HTTP, shape the data and send an email',
      description: 'Run manually: call an HTTP address, collect the result with "Set data", then send an email.',
    },
    nodes: [
      { id: 'manual_trigger', type: 'trigger.manual', name: 'Chạy thủ công', config: {} },
      {
        id: 'fetch_data',
        type: 'http.request',
        name: 'Gọi HTTP',
        config: { method: 'GET', url: 'https://wttr.in/Hanoi?format=3' },
      },
      {
        id: 'prepare_message',
        type: 'data.set',
        name: 'Đóng gói dữ liệu',
        config: { fields: { title: 'Kết quả gọi HTTP', result: '{{ nodes.fetch_data.output.data }}' } },
      },
      {
        id: 'send_email',
        type: 'email.send',
        name: 'Gửi email',
        config: {
          subject: '{{ nodes.prepare_message.output.title }}',
          body: '{{ nodes.prepare_message.output.result }}',
        },
      },
    ],
    edges: chain('manual_trigger', 'fetch_data', 'prepare_message', 'send_email'),
  },
  {
    id: 'telegram-control-bot',
    category: 'chat',
    vi: {
      name: 'Bot Telegram điều khiển quy trình',
      description: 'Nhắn /status, /run, /pause, /resume hoặc /failures cho bot để điều khiển và xem tình trạng quy trình ngay trong Telegram.',
    },
    en: {
      name: 'Telegram bot that controls workflows',
      description: 'Message /status, /run, /pause, /resume or /failures to the bot to control and check workflows from Telegram.',
    },
    nodes: [
      { id: 'telegram_trigger', type: 'trigger.telegram', name: 'Nhận lệnh Telegram', config: {} },
      { id: 'control', type: 'weav.workflow', name: 'Điều khiển quy trình', config: { operation: 'command', text: '{{ trigger.input.message.text }}', sender: '{{ trigger.input.message.from.id }}' } },
      {
        id: 'send_reply',
        type: 'telegram.send_message',
        name: 'Trả lời kết quả',
        config: { chatId: '{{ trigger.input.message.chat.id }}', text: '{{ nodes.control.output.reply }}' },
      },
    ],
    edges: chain('telegram_trigger', 'control', 'send_reply'),
  },
  {
    id: 'failure-alert-email',
    category: 'chat',
    vi: {
      name: 'Cảnh báo lỗi qua email',
      description: 'Khi một quy trình trong không gian làm việc chạy lỗi, gửi email báo tên quy trình và lý do lỗi. Nhập địa chỉ nhận sau khi tạo.',
    },
    en: {
      name: 'Failure alert by email',
      description: 'When a workflow in the workspace fails, email its name and the error. Enter the recipient after creating it.',
    },
    nodes: [
      { id: 'workflow_event', type: 'trigger.workflow_event', name: 'Quy trình chạy lỗi', config: { events: ['FAILED'] } },
      {
        id: 'send_email',
        type: 'email.send',
        name: 'Gửi email cảnh báo',
        config: {
          subject: 'Quy trình "{{ trigger.input.workflowName }}" chạy lỗi',
          body: 'Quy trình {{ trigger.input.workflowName }} lỗi lúc {{ trigger.input.finishedAt }}. Mã lỗi: {{ trigger.input.errorCode }}. {{ trigger.input.errorMessage }}',
        },
      },
    ],
    edges: chain('workflow_event', 'send_email'),
  },
  {
    id: 'failure-alert-discord',
    category: 'chat',
    vi: {
      name: 'Cảnh báo lỗi qua Discord',
      description: 'Khi một quy trình trong không gian làm việc chạy lỗi, gửi tin nhắn vào kênh Discord qua webhook.',
    },
    en: {
      name: 'Failure alert on Discord',
      description: 'When a workflow in the workspace fails, post a message to a Discord channel through a webhook.',
    },
    nodes: [
      { id: 'workflow_event', type: 'trigger.workflow_event', name: 'Quy trình chạy lỗi', config: { events: ['FAILED'] } },
      {
        id: 'send_discord',
        type: 'discord.send_message',
        name: 'Gửi tin nhắn Discord',
        config: { content: 'Quy trình "{{ trigger.input.workflowName }}" chạy lỗi ({{ trigger.input.errorCode }}): {{ trigger.input.errorMessage }}' },
      },
    ],
    edges: chain('workflow_event', 'send_discord'),
  },
];

/** Templates that use a Telegram node, linked from the Telegram page. */
export const TELEGRAM_TEMPLATE_IDS = WORKFLOW_TEMPLATES
  .filter((template) => template.nodes.some((node) => node.type.includes('telegram')))
  .map((template) => template.id);

const NODE_X_STEP = 280;

/** Payload for workflowV1Api.createWorkflowFromDefinition. */
export function templateToDraft(template: WorkflowTemplate, name: string) {
  return {
    name,
    definition: {
      schemaVersion: '1.0' as const,
      nodes: template.nodes.map((node) => ({ id: node.id, type: node.type, config: node.config })),
      edges: template.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
      })),
      variables: {},
    },
    layout: Object.fromEntries(
      template.nodes.map((node, index) => [node.id, { name: node.name, position: { x: 80 + index * NODE_X_STEP, y: 160 } }]),
    ) as Record<string, { name: string; position: { x: number; y: number } }>,
  };
}
