export const menu = 'Iced tea or coffee · small or large · with or without ice · for here or takeaway';
// Shared menu vocabulary for the cashier's ticket, never a customer's target order.
export const ticketFields = [
  { name: 'drink', label: 'Drink', options: ['Iced tea', 'Coffee'] },
  { name: 'size', label: 'Size', options: ['Small', 'Large'] },
  { name: 'ice', label: 'Ice', options: ['With ice', 'Without ice'] },
  { name: 'place', label: 'To have it', options: ['Here', 'To go'] }
];
export const norms = 'Give each other time and let each person finish what they’re saying. Don’t finish someone’s words or coach their speech unless they ask you to. Either of you can pause or leave at any point, and typing or pointing counts just as much as speaking.';
export const briefs = {
  customer: 'Pick your order privately, in your head or on your own paper. The app does not ask for your intended order. When the conversation starts, ask for what you want, answer the cashier’s questions, and correct anything they get wrong. If they share a ticket, you can review it together or skip it. You don’t have to sound fluent to do this well.',
  cashier: 'Greet the customer and ask what they’d like. Respond to what they actually say rather than what you expect. If something is missing, like the size, ask about it. You can write what you understood on the order ticket and share it for an optional review. Read the order back and give them all the time they need.',
  host: 'Find two people who want to practice and send them the invitation. Let them in, give one the customer role and the other the cashier role, and explain how to ask for time, pause, or leave. Start once both are ready, then let them talk without stepping in.'
};
