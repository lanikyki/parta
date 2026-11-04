import { Plus } from 'lucide-react';
import { PLANS, TRIAL_MIN, rub } from '@/lib/plans';
import { SectionHead } from './SectionHead';

const FAQ = [
  [
    'Сколько это стоит?',
    `Ученикам — бесплатно. Репетитору бесплатны кабинет, переписка, доска и чат, а первый урок с видео — ${TRIAL_MIN} минут без оплаты. Дальше — подписка: «${PLANS.start.name}» за ${rub(PLANS.start.price.month)} в месяц (видеоуроки один на один) или «${PLANS.pro.name}» за ${rub(PLANS.pro.price.month)} (группы до ${PLANS.pro.video} человек и больше ИИ-функций).`,
  ],
  [
    'Нужно ли что-то устанавливать?',
    'Нет. Уроки проходят в браузере — подойдут Chrome, Яндекс Браузер, Edge, Firefox и Safari на компьютере, планшете или телефоне.',
  ],
  [
    'Ученику обязательно регистрироваться?',
    'Нет: чтобы попасть на урок, достаточно открыть ссылку и ввести имя. Если ученик зарегистрируется по вашему приглашению, он появится в вашем списке — можно переписываться, а доски и конспекты уроков сохранятся у него в кабинете.',
  ],
  [
    'Что нужно для занятия?',
    'Браузер и стабильный интернет. Камера и микрофон желательны, но и без них в урок можно войти: видеть и слышать остальных, писать на доске и в чате.',
  ],
  [
    'Можно заниматься в группе?',
    `Да. В групповом уроке на тарифе «${PLANS.pro.name}» — до ${PLANS.pro.video} участников с видео: репетитор видит всех, а ученики могут писать на общей доске, если репетитор разрешит.`,
  ],
  [
    'Как работает переписка?',
    'В разделе «Сообщения» репетитор и ученик общаются между уроками. Если сообщение долго не прочитано, придёт письмо на почту.',
  ],
  [
    'Как работает ИИ-помощник?',
    'Репетитору он подбирает задачи по теме и составляет конспект урока. Ученику объясняет темы простым языком и проверяет решения — подсказывает, а не решает за него.',
  ],
];

export function Faq() {
  return (
    <section id="faq" className="wrap pb-20 sm:pb-28">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <SectionHead
          tag="Вопросы"
          title="Частые вопросы"
          text={
            <>
              Не нашли ответ?{' '}
              <a href="#lead" className="text-brand-700 underline underline-offset-4 hover:text-brand">
                Задайте вопрос
              </a>{'\u00a0'}
              — ответим на почту или в Telegram.
            </>
          }
        />
        <div data-reveal className="grid gap-3">
          {FAQ.map(([q, a], i) => (
            <details key={q} className="faq group rounded-[20px] bg-mist px-5 transition-colors open:bg-tint sm:px-6" open={i === 0}>
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 text-[18px] font-medium">
                {q}
                <span className="faq-icon grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-brand transition-transform duration-200">
                  <Plus size={18} />
                </span>
              </summary>
              <p className="-mt-1 pb-5 leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
