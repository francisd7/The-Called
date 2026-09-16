// Fixed team mentions for the welcome message - these are specific named
// people (Noah as CSM, Andrew as CMO), not per-automation routing config, so
// they live here as constants rather than env vars, same as other message
// copy in this codebase.
const NOAH_CSM_MENTION = '<@414934911724552202>';
const ANDREW_CMO_MENTION = '<@491021691367981056>';
const FRANCIS_COO_MENTION = '<@584241323981406221>';

export function formatWelcomeMessage({ memberMention, notionDashboardUrl }) {
  const trimmedUrl = notionDashboardUrl?.trim();
  const dashboardLine = trimmedUrl
    ? `Here is your Notion Dashboard: ${trimmedUrl}`
    : 'You will get your Notion Dashboard shortly.';

  // The intake form is the one thing a brand-new member can act on before
  // their Notion lands, so without a dashboard link it's framed as the
  // stopgap ("in the meantime"). Once the link is there they aren't waiting
  // on anything, so that framing would read wrong - hence both versions.
  const intakeFormLine = trimmedUrl
    ? "This intake form is part of onboarding as well — complete it before your call with Noah, so he walks in already knowing what you came here for instead of spending the call on discovery."
    : "In the meantime, here's something you can knock out right now — complete this intake form before your call with Noah, so he walks in already knowing what you came here for instead of spending the call on discovery.";

  return `${memberMention} — welcome to The Called 🔥

You didn't just sign up for a program. You stepped into a brotherhood of men who are done playing small in business and in life and we take that seriously. Glad you're here.

Here's who's in your corner:
${NOAH_CSM_MENTION} is your CSM (Client Success Manager) — With an incredible track record, he is a wealth of knowledge and will be your point of contact from here forward. He'll review your work, keep you accountable, and make sure the effort you put in actually turns into progress you can see.
${ANDREW_CMO_MENTION} is our CMO, he's behind the marketing and systems that power everything you'll be using here.
I'm ${FRANCIS_COO_MENTION}, COO, I run the operations on the backend so your experience here runs the way it's supposed to. I also help with the DM Setting side of the business.

Inside your notion you will find tasks on the Follow and Track In Order section in orange. Knock all of those out before you hop on your 1:1 onboarding call with Noah.

Let's get to work 📈

---
${dashboardLine}
${intakeFormLine}
https://tally.so/r/KYEgkX

Let us know if you have any questions along the way. Once again, make sure all the items in orange on the Follow and Track In Order are completed before you get on your call. The booking link for your 1:1 call is inside the notion.

---
🚨 One more thing — reply here with your **email address** so we can get your account linked up and send you your Notion Dashboard.`;
}

// Sent in the member's channel once their email is matched (or a starter
// Client record is created for them). Lives here with the rest of the
// onboarding copy rather than inline at the two call sites that send it.
export const EMAIL_CONFIRMED_MESSAGE =
  "You're all set! ✅ Your Notion Dashboard is on its way — hang tight.";
