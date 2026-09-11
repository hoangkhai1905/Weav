import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

interface DataPoint {
  day: string;
  count: number;
  successRate: string;
  x: number;
  y: number;
}

const CHART_DATA: DataPoint[] = [
  { day: 'Mon', count: 12, successRate: '100%', x: 10, y: 140 },
  { day: 'Tue', count: 18, successRate: '96%', x: 95, y: 120 },
  { day: 'Wed', count: 22, successRate: '98%', x: 180, y: 95 },
  { day: 'Thu', count: 16, successRate: '100%', x: 265, y: 115 },
  { day: 'Fri', count: 28, successRate: '100%', x: 350, y: 75 },
  { day: 'Sat', count: 36, successRate: '99%', x: 435, y: 35 },
  { day: 'Sun', count: 30, successRate: '98%', x: 520, y: 60 },
];

export const WorkflowActivityChart: React.FC = () => {
  const { t } = useI18nStore();
  // Default hoveredIdx to 5 (Fri) to match reference.png
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(5);

  const points = CHART_DATA.map((d) => `${d.x},${d.y}`).join(' ');
  const polygonPoints = `10,140 ${points} 520,155 10,155`;

  const activeItem = hoveredIdx !== null ? CHART_DATA[hoveredIdx] : CHART_DATA[5];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 sm:p-5 flex flex-col justify-between shadow-2xs h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-col">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {t('dashboard.activity')}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              128 {t('dashboard.executions_count')}
            </span>
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              +18.4% {t('dashboard.vs_previous')}
            </span>
          </div>
        </div>

        <button className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-colors">
          <span>{t('dashboard.last_7_days')}</span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
      </div>

      {/* SVG Interactive Chart Canvas */}
      <div className="relative w-full h-[210px] pt-2">
        {/* Active Floating Tooltip */}
        <div
          className="absolute z-20 pointer-events-none px-2.5 py-1.5 rounded-md bg-slate-900 text-white font-mono text-[11px] shadow-md transition-all duration-150 transform -translate-x-1/2 -translate-y-full"
          style={{
            left: `${(activeItem.x / 540) * 100}%`,
            top: `${(activeItem.y / 180) * 100 - 8}px`,
          }}
        >
          <div className="font-semibold text-white leading-tight">
            {activeItem.day}: {activeItem.count} {t('dashboard.runs')}
          </div>
          <div className="text-emerald-400 text-[10px] leading-tight mt-0.5">
            {activeItem.successRate} {t('dashboard.success_rate')}
          </div>
        </div>

        <svg className="w-full h-full overflow-visible" viewBox="0 0 540 180" preserveAspectRatio="none">
          <defs>
            <linearGradient id="chartGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Grid Lines */}
          <line x1="0" y1="20" x2="540" y2="20" stroke="currentColor" strokeDasharray="3 3" strokeWidth="1" className="text-slate-200 dark:text-slate-800" />
          <line x1="0" y1="65" x2="540" y2="65" stroke="currentColor" strokeDasharray="3 3" strokeWidth="1" className="text-slate-200 dark:text-slate-800" />
          <line x1="0" y1="110" x2="540" y2="110" stroke="currentColor" strokeDasharray="3 3" strokeWidth="1" className="text-slate-200 dark:text-slate-800" />
          <line x1="0" y1="155" x2="540" y2="155" stroke="currentColor" strokeWidth="1" className="text-slate-200 dark:text-slate-800" />

          {/* Gradient Area */}
          <polygon points={polygonPoints} fill="url(#chartGrad)" />

          {/* Animated Trend Line */}
          <motion.path
            d={`M 10,140 L 95,120 L 180,95 L 265,115 L 350,75 L 435,35 L 520,60`}
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />

          {/* Active Vertical Guideline */}
          <line
            x1={activeItem.x}
            y1={20}
            x2={activeItem.x}
            y2={155}
            stroke="#2563eb"
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity="0.6"
          />

          {/* Data Points */}
          {CHART_DATA.map((pt, idx) => {
            const isSelected = activeItem.day === pt.day;

            return (
              <g
                key={idx}
                onMouseEnter={() => setHoveredIdx(idx)}
                className="cursor-pointer"
              >
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected ? 5 : 3.5}
                  fill={isSelected ? '#2563eb' : '#ffffff'}
                  stroke="#2563eb"
                  strokeWidth="2"
                  className="transition-all duration-150"
                />
              </g>
            );
          })}
        </svg>

        {/* X-Axis Labels */}
        <div className="flex justify-between items-center text-xs font-mono text-slate-400 dark:text-slate-500 pt-2 px-1">
          {CHART_DATA.map((d, i) => {
            const isActive = activeItem.day === d.day;
            return (
              <span
                key={i}
                onMouseEnter={() => setHoveredIdx(i)}
                className={`cursor-pointer transition-colors ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400 font-bold'
                    : 'hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {d.day}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
