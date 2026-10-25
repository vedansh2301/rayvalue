/**
 * Florida battery and resilience notes (Phase 3.3), shared by the Florida calculator page (Astro) and the
 * results card (Preact). Factual and neutral; no figures. It matches the calculator's Florida model, which
 * credits solar sent to the grid at the retail rate (net metering), so a battery adds cost but no bill savings
 * in the estimate (see the Florida assumption text in src/lib/calc/calculate.ts).
 * Owner: review before launch.
 */
export interface Note {
  heading: string;
  body: string;
}

export const FL_BATTERY_TITLE = 'Battery backup in Florida: what it does and what it does not';

export const FL_BATTERY_INTRO =
  'A home battery is mostly a backup-power choice, not a way to pay solar off faster. Here is what to expect so you can compare it with what installers offer.';

export const FL_BATTERY_NOTES: Note[] = [
  {
    heading: 'What a battery can power',
    body: 'During a grid outage, a battery can keep chosen circuits running, usually things like lights, the refrigerator, internet and phone charging. Which circuits, and for how long, depends on how the system is wired and on the battery’s capacity and power rating.',
  },
  {
    heading: 'What it does not do on its own',
    body: 'Solar panels without a battery usually shut off when the grid goes down, so they do not power your home during an outage. A battery also may not run everything at once: central air conditioning, an electric water heater or several large appliances need much more capacity than essentials. Ask installers which loads a quoted system covers.',
  },
  {
    heading: 'How long it lasts',
    body: 'That depends on what you run and how much sun is available to recharge it the next day. Running only essential loads stretches it furthest.',
  },
  {
    heading: 'Cost and payback',
    body: 'A battery raises the upfront cost. In Florida, utilities credit the solar you send to the grid through net metering, so in this estimate a battery adds cost but no extra bill savings, and payback gets longer. That is why batteries are chosen for backup power rather than for payback.',
  },
];

export const FL_BATTERY_CLOSING = 'Whether backup is worth the added cost is a personal call. Compare the same home with and without a battery in the calculator, then ask installers to quote both.';
