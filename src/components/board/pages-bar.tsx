'use client';

import { ChevronLeft, ChevronRight, Ellipsis, FileUp, Grid3x3, Grip, Plus, Rows3, Square, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PageBg } from '@/lib/board/types';
import { type Menu, ToolButton } from './ui';

/** Пункт меню: подпись, значок, действие. */
export type MenuItem = [string, LucideIcon, () => void];

const BGS: [PageBg, string, LucideIcon][] = [
  ['grid', 'Клетка', Grid3x3],
  ['lines', 'Линейка', Rows3],
  ['dots', 'Точки', Grip],
  ['plain', 'Чистый', Square],
];

/** Панель листов: назад/вперёд, новый лист, фон, PDF, удаление и меню «Ещё». На телефоне всё, кроме стрелок, — в меню ⋯. */
export function PagesBar({
  place,
  compact,
  index,
  count,
  locked,
  canDraw,
  isHost,
  current,
  menu,
  setMenu,
  onGo,
  onAdd,
  onPdf,
  onDelete,
  onBg,
  more,
}: {
  /** Где стоит панель (классы Tailwind). */
  place: string;
  compact: boolean;
  index: number;
  count: number;
  /** «Все за мной» у ученика: листы листает репетитор. */
  locked: boolean;
  canDraw: boolean;
  isHost: boolean;
  current?: PageBg;
  menu: Menu;
  setMenu: (m: Menu) => void;
  onGo: (d: number) => void;
  onAdd: () => void;
  onPdf: () => void;
  onDelete: () => void;
  onBg: (bg: PageBg) => void;
  more: MenuItem[];
}) {
  const pageActions: MenuItem[] = canDraw
    ? [['Новый лист', Plus, onAdd], ['Загрузить PDF', FileUp, onPdf], ...(count > 1 ? ([['Удалить лист', Trash2, onDelete]] as MenuItem[]) : [])]
    : [];
  const menuButton = ([label, Icon, act]: MenuItem, cls: string) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setMenu(null);
        act();
      }}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] hover:bg-mist ${cls}`}
    >
      <Icon size={17} className="shrink-0" /> {label}
    </button>
  );

  return (
    <div data-ui className={`absolute z-10 flex items-center gap-0.5 rounded-2xl bg-white p-1 shadow-lift ${place}`}>
      <ToolButton title="Предыдущий лист" disabled={index === 0 || locked} onClick={() => onGo(-1)}>
        <ChevronLeft size={19} />
      </ToolButton>
      <span className={`px-1 text-center font-mono text-[13px] text-ink-2 ${compact ? 'min-w-[44px]' : 'min-w-[64px]'}`}>
        {index + 1} / {count}
      </span>
      <ToolButton title="Следующий лист" disabled={index >= count - 1 || locked} onClick={() => onGo(1)}>
        <ChevronRight size={19} />
      </ToolButton>
      {compact && (
        <div className="relative">
          <ToolButton title={canDraw ? 'Листы и фон' : 'Ещё: печать и PDF'} active={menu === 'pages'} onClick={() => setMenu(menu === 'pages' ? null : 'pages')}>
            <Ellipsis size={19} />
          </ToolButton>
          {menu === 'pages' && (
            <div className="absolute top-12 left-0 z-20 grid w-60 gap-0.5 rounded-xl bg-white p-1.5 shadow-lift">
              {[...pageActions, ...more].map((it) => menuButton(it, 'min-h-10 py-1.5 leading-tight'))}
              {canDraw && (
                <>
                  <span className="mx-2 my-1 h-px bg-line" />
                  <span className="px-2.5 pt-0.5 pb-1 text-[12px] text-ink-3">Фон листа</span>
                  <div className="grid grid-cols-4 gap-1 px-1 pb-0.5">
                    {BGS.map(([bg, label, Icon]) => (
                      <button
                        key={bg}
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={() => onBg(bg)}
                        className={`grid h-10 place-items-center rounded-lg ${current === bg ? 'bg-tint text-brand-800' : 'text-ink-2 hover:bg-mist'}`}
                      >
                        <Icon size={17} />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {canDraw && !compact && (
        <>
          <span className="mx-0.5 h-6 w-px bg-line" />
          <ToolButton title="Новый лист" onClick={onAdd}>
            <Plus size={19} />
          </ToolButton>
          <div className="relative">
            <ToolButton title="Фон листа" onClick={() => setMenu(menu === 'bg' ? null : 'bg')}>
              <Grid3x3 size={19} />
            </ToolButton>
            {menu === 'bg' && (
              <div className="absolute bottom-12 left-1/2 z-20 grid w-44 -translate-x-1/2 gap-0.5 rounded-xl bg-white p-1.5 shadow-lift">
                {BGS.map(([bg, label, Icon]) => (
                  <button
                    key={bg}
                    type="button"
                    onClick={() => onBg(bg)}
                    className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-[14px] ${current === bg ? 'bg-tint text-brand-800' : 'hover:bg-mist'}`}
                  >
                    <Icon size={16} /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ToolButton title="Загрузить PDF или презентацию (PDF)" onClick={onPdf}>
            <FileUp size={19} />
          </ToolButton>
          {count > 1 && (
            <ToolButton title="Удалить лист" onClick={onDelete}>
              <Trash2 size={18} />
            </ToolButton>
          )}
        </>
      )}
      {!compact && (
        <div className="relative">
          <ToolButton
            title={isHost ? 'Ещё: очистить, печать и PDF, горячие клавиши' : 'Ещё: печать и PDF, горячие клавиши'}
            active={menu === 'more'}
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
          >
            <Ellipsis size={19} />
          </ToolButton>
          {menu === 'more' && (
            <div className="absolute right-0 bottom-12 z-20 grid w-64 gap-0.5 rounded-xl bg-white p-1.5 shadow-lift">{more.map((it) => menuButton(it, 'h-10'))}</div>
          )}
        </div>
      )}
    </div>
  );
}
