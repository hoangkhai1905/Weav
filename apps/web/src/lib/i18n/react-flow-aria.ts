import type { AriaLabelConfig } from '@xyflow/react';
import type { Language } from './translations';

type Translate = (key: string) => string;

export function createReactFlowAriaLabelConfig(t: Translate, language: Language): Partial<AriaLabelConfig> {
  const directions: Record<string, string> = {
    left: t('builder.a11y.direction_left'),
    right: t('builder.a11y.direction_right'),
    up: t('builder.a11y.direction_up'),
    down: t('builder.a11y.direction_down'),
  };

  return {
    'node.a11yDescription.default': t('builder.a11y.node_default'),
    'node.a11yDescription.keyboardDisabled': t('builder.a11y.node_keyboard_disabled'),
    'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
      t('builder.a11y.node_moved')
        .replace('{direction}', directions[direction] ?? direction)
        .replace('{x}', new Intl.NumberFormat(language === 'VI' ? 'vi-VN' : 'en-US').format(x))
        .replace('{y}', new Intl.NumberFormat(language === 'VI' ? 'vi-VN' : 'en-US').format(y)),
    'edge.a11yDescription.default': t('builder.a11y.edge_default'),
    'controls.ariaLabel': t('builder.a11y.controls'),
    'controls.zoomIn.ariaLabel': t('builder.a11y.zoom_in'),
    'controls.zoomOut.ariaLabel': t('builder.a11y.zoom_out'),
    'controls.fitView.ariaLabel': t('builder.a11y.fit_view'),
    'controls.interactive.ariaLabel': t('builder.a11y.toggle_interactivity'),
    'minimap.ariaLabel': t('builder.a11y.minimap'),
    'handle.ariaLabel': t('builder.a11y.handle'),
  };
}
