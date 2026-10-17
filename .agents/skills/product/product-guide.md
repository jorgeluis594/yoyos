# Guide for defining product in Yoyos

This guide describes how a feature is defined at the product level: what problem it solves, what it does, what each person sees, what rules govern it, what happens when something fails and what is left out. It does not describe how it is built or what the product looks like today. The technical side is defined later, in the implementation phase. The current state of the product (what exists, what was decided, which values were fixed, which constraints are not up for discussion) comes from the repository memory and the current documents in `docs/`, never from this guide.

It is used by walking through the steps in order. Each step has rules with an example and, when it helps, what is not done. The examples are illustrative: they show the shape of the decision in a business that sells through chat. They do not describe how Yoyos works nor are they decisions already made.

Stable context: Yoyos is for small businesses that sell through WhatsApp and Instagram. There is a seller who operates mostly from the phone, with the customer waiting in the chat, and a buyer who usually arrives through a link. Everything else is verified.

---

## Step 1. Understand the problem and who it happens to

**1.1 Start from a concrete situation, not a category.**
Before proposing anything, write what the seller or buyer does today without the feature, when it happens and what goes wrong. If a concrete story cannot be told, the problem is not understood yet.
- Example: "The seller receives an 'I already paid you' at 9 pm, opens their bank app, looks for the transaction and writes in a notebook which order got paid. The next day they do not remember whether the S/ 120.00 one was Carla's or Rosa's."
- Do not: "Sellers need to manage their payments."

**1.2 The user is defined by the situation they are in, not by who they are.**
For each feature, name each actor by what they are doing at that moment.
- Example: "seller recording an in-store sale with the customer in front of them", "buyer who opened a link from the chat and has no account", "seller checking at night what is still unpaid".

**1.3 Identify which part of the problem is already solved by talking.**
The seller and the buyer already talk through chat. Before designing a step, ask whether that step already happens in the conversation. If it happens there, the product records the result and does not replace it.
- Example: if the buyer underpaid, the seller writes to them and they agree on the balance. The product records the partial payment and shows the balance; it does not offer a «Claim difference» button.

**1.4 The expected outcome is written as a hypothesis.**
What changes in the seller's or buyer's behavior if the feature works, and how it would show. Improvements that will not be observed are not promised.
- Example: "If it works, the seller stops asking for the payment screenshot through chat and receives it attached to the order; it would show in the share of reported payments with a screenshot."

---

## Step 2. Bound the first version

**2.1 The first version covers the usual case end to end and nothing more.**
Design what the seller does every day, complete. Rare cases are resolved with a clear notice and a manual way out, not with additional mechanisms.
- Example: a first version of label printing prints one label with the remembered printer. If two people print at once and one fails, the app notifies and offers a retry. No queue or turn system is designed.
- Do not: design for the scenario the seller would not run in practice.

**2.2 Cut by visible dimensions, never by reliability.**
To keep the first version small, limit types, channels, platforms or countries. What goes in goes in complete and reliable.
- Example: receiving messages can start with only text and images from individual chats. But none of the messages that do go in may be lost.
- Do not: accept more types "with occasional loss" to show more scope.

**2.3 Extend what exists before creating something new.**
If there is already a screen, a list, a flow or a concept that covers the case, extend it. A new concept needs a sentence explaining why an existing one does not work; if there is none, it is not created.
- Example: a buyer's "payment notice" does not need to be a separate thing if payments already have states: it can be a payment in the «reported» state in the same list.
- Do not: a new entity with its own screen for something that only changes the state of another.

**2.4 What is solved by talking does not become a flow.**
If a step happens in the chat (requesting changes, clarifying a payment, agreeing on an agency), the product does not mediate it. What was agreed is recorded and, when needed, it is stated that the adjustment is resolved outside the app.
- Do not: disputes, rejections, internal messaging or notifications for situations a conversation resolves.

**2.5 Typed data is enough to start.**
Addresses, couriers, agencies and banks are typed by hand. Maps, product-maintained catalogs and pickers are deferred until usage shows they are needed.
- Example: a delivery address with street, district and directions as text, without a map.

**2.6 Every daily seller operation goes on web and mobile from the first version.**
If a feature belongs to the seller, it is defined on both platforms with the same behavior, unless it depends on a device capability (camera, printer next to the merchandise). In that case that capability is used even if the web lacks it.
- Do not: "web only" as the first version of something the seller does daily.

**2.7 Build in vertical slices.**
The first slice is the simplest complete case: configuration, usage, what the seller sees, what the buyer sees. The next ones add cases. Do not build all the configuration before anyone can use anything.
- Example: deliveries is defined as "store pickup" complete (configure the point, assign it to an order, see it on web and mobile), then home delivery, then agency.

**2.8 Respect the cut between features.**
Each feature is defined in its own task. What belongs to another does not go in, even if it is close, but the design leaves the meeting point clear so the other only adds.
- Example: if the buyer checkout is another task, payment is defined with a provisional view of the order and it is stated that the checkout will show that same payment when it arrives.

---

## Step 3. Design the flow and the screens

**3.1 The usual path takes the fewest taps.**
Identify the action the seller does almost always and make it the main action, with the defaults loaded and what is already known prefilled. Exceptions live in settings or secondary actions, not in a dialog that appears every time.
- Example: if almost every new product needs a label, the main action on create is **Save and print** with one copy and the remembered printer. On edit, **Save** and **Print** are independent because editing does not usually imply reprinting.
- Do not: mandatory empty fields when the usual value is known; a configuration step in every operation.

**3.2 Controls follow the platform convention; behavior is the same everywhere.**
A list on mobile uses «Load more» and sheets for filters; on web, numbered pages and panels. What does not change between platforms are the results, the order, the rules and the texts.
- Do not: invent a different rule on mobile under the excuse of the mobile pattern.

**3.3 The user's work is never lost without their permission.**
On returning to a screen, the search, the loaded list and the position are kept. Leaving a form with changes asks for confirmation. A rejection returns to the screen with what was typed intact and the affected element marked.
- Example: the seller builds a sale with three products, confirms, and one has no stock. The sale stays on the review screen with the three products and the missing one marked.
- Do not: reset the list on return, empty a form because of an error, silently overwrite a change made from another device.

**3.4 Every screen defines its states and the text for each.**
What is shown when there is nothing yet, when loading, when there are no results for these filters, when loading failed and when there are too many items. They are different states with different texts.
- Example: «You have not recorded sales yet. Create the first one from Products» versus «No sales between October 1 and 7» versus «Could not load the history» with **Retry**.
- Do not: one empty list for all three cases; show an empty list when what happened is that there was no connection.

**3.5 While an operation is in doubt, another of the same kind is not started.**
If an action with effect got no response, the screen shows it, offers to verify or redo, and blocks starting another of the same type until it is resolved.

**3.6 A business identifier is shown complete or not at all.**
A code, an order number or a transaction number is never truncated with an ellipsis: two different items would look the same. If it does not fit, another presentation is used or a notice is shown, without blocking the main operation.
- Example: if a variant's code does not fit on the label, the label is not printed and this is explained, but the product is saved.

**3.7 Actions say what they do and confirmations name the result.**
«Confirm payment», not «Accept». «Delete order» and «Keep order», not «Yes» and «No».

---

## Step 4. Fix the business rules

**4.1 For each piece of data, define who is the source that counts.**
What one party declares is a notice; what the responsible party verifies is what counts. The document says, for each piece of data with consequences (amounts, prices, totals, stock, execution dates), who sets it and who can only notify.
- Example: in a payment flow, the buyer can report that they paid and attach evidence, but the amount that reduces the balance is entered by the seller after checking their bank.
- Do not: accept as fact a piece of data the interested party declares without verification.

**4.2 Identify processes with their own cycle and do not chain them.**
Money, dispatch and stock are usually distinct processes: each with its states and its corrections. Changing one does not touch the others unless the document explicitly says why.
- Example: voiding a payment recorded by mistake on an already delivered order does not change the delivery nor return stock.
- Do not: prevent a correction in one process because another process moved forward.

**4.3 What was agreed is edited freely until it is executed; then it freezes.**
While an action has not been executed in the real world, its data can be corrected. Once executed, that data describes what happened and stays fixed; later errors are resolved with a note or a separate correction.
- Example: a delivery address is changed as many times as needed before dispatch; after marking «Shipped» it is no longer edited.

**4.4 Record even if data is missing; gaps are shown and required only when an action needs them.**
A missing piece of data is a presentation («to be defined»), not a new state or a block. It is required in the action that needs it.
- Example: a sale is recorded without yet knowing how it will be delivered; dispatching does require a destination.
- Do not: reject creation because of fields completed later; invent a "without X" state.

**4.5 Days are interpreted in the business's time.**
A «today's sales» filter spans from 00:00 to 23:59 in the business's time zone. Which time zone and whether there is one per business is verified in the repository memory.

**4.6 Each process has a purpose and does not complete another by accident.**
Two processes that share a mechanism (for example, two kinds of email link) each have their own expiry, text and effect. Completing one does not complete the other.

**4.7 When what was agreed changes in substance, it is a new agreement.**
If the essence of an order changes (the products, for example), define whether that is an edit or a new order, and write the rule. In general, a visible identifier must keep describing the same thing that was agreed.

---

## Step 5. Define states and what can change when

**5.1 Each state has a name, a meaning for the user and allowed transitions.**
For everything with a lifecycle, list each state with what it means, what triggers it, what can be done in it and what each actor sees. A state is defined by what the user needs to distinguish.
- Example: a payment can be «reported» (someone said they paid, does not count), «confirmed» (verified, counts) or «voided» (it was a mistake, does not count but is kept). The allowed transitions are listed and which ones are final.
- Do not: loose flags ("has error", "is printing") without a closed set of states.

**5.2 A state exists only if someone queries it or acts on it; the rest is presentation.**
If nobody filters, counts or decides by a condition, it is not a state: it is a way of showing data that already exists.
- Example: «Delivery to be defined» is not a delivery state; it is how an order without an assigned delivery is shown. «Pending confirmation» is one if the seller wants to see which ones are waiting.
- Do not: states that exist to wait for another feature.

**5.3 What already existed does not inherit new states or invented data.**
When a state or piece of data is introduced, previous records remain as "without that data", explicitly.
- Example: when launching a confirmation flow, orders created before do not show as «pending confirmation»: they simply do not have it.

**5.4 Records with effect are corrected by voiding and creating another, not by editing.**
Voiding keeps the original, who voided and when. Voiding does not mean refunding money.
- Example: a payment of S/ 150.00 was confirmed when S/ 115.00 arrived: the 150 one is voided and one of 115 is recorded.

**5.5 No states or steps are created to wait for another feature.**
The current one is defined complete without that something; the integration happens when it arrives.

---

## Step 6. Define what happens when something fails

Every action with effect (create, confirm, pay, print, send) is defined with four possible outcomes, and the document says what the user sees in each:

| Outcome | What happened | What the user sees |
|---|---|---|
| Success | The action completed | Confirmation that names what is actually guaranteed |
| Known rejection | The product said no (missing stock, invalid amount, cancelled order) | Returns to the screen with their work intact and the reason next to the affected element, with the remedy |
| Not sent | It never left (no connection, local validation) | Notice and the option to retry without risk |
| In doubt | It left but no response arrived | Notice that it may have completed; verified before repeating |

**6.1 An outcome in doubt is never presented as success nor repeated automatically.**
It is verified before offering to repeat, and repeating never creates two sales, two products or two labels.
- Example: a print job is sent and the wait times out. «It may have printed; check the printer before repeating», with **Print again**.
- Do not: show «Saved» without confirmation; retry in a loop.

**6.2 Repeating out of doubt does not create duplicates.**
If the user repeats an action that already completed, the product recognizes it and says so: «This product was already created», with a link to view it.

**6.3 The main effect is not undone because the secondary one fails.**
If an action has a main effect and a secondary one, failure of the secondary does not delete or repeat the main one. A notice is shown and only the secondary is offered for retry.
- Example: **Save and print** saves the product and then the printer fails: the product stays created and **Retry print** is offered, keeping quantity and printer.

**6.4 A known rejection is corrected in place.**
The user returns to the screen with everything they typed, the affected element marked and the remedy in the message.
- Example: «The total changed to S/ 95.00. Review and confirm again», with the form intact.
- Do not: «An error occurred» without saying which or where.

**6.5 Messages speak the user's language and name the real guarantee.**
No technical names or internal codes. «Sent to the printer» is not «printed»; «accepted by the provider» is not «delivered».

**6.6 Never continue as if something was saved when it was not.**
If saving fails, the app says so and stops what depended on it. "No data" and "could not read" are different situations and are shown differently.

**6.7 A late response, or one from another session, does not change what is on screen.**
Only the response to the visible attempt updates the screen.

---

## Step 7. Define who sees and does what

**7.1 Each actor has their own access, and access opens exactly what it is.**
The seller signs in with their account and sees their business's data. A buyer who enters through a link sees and does only what that link is. Knowing a link or a number opens nothing else.
- Example: an order's link allows viewing and confirming that order; it does not allow viewing other orders or acting as the seller.

**7.2 Protection is the minimum that closes the real risk, and the risk is named.**
Before adding a layer (expiry, extra verification, second factor), write which concrete risk it closes. If there is no nameable risk, it is not added.
- Example: if the risk is someone guessing other people's links, an unguessable link solves it; an expiry is not needed on top.

**7.3 Public responses do not reveal what they should not.**
Signing up with an already used email or requesting recovery for an unknown email respond the same as the normal case. Someone else's resource responds as if it did not exist.

**7.4 Each party sees the minimum it needs; evidence is seen by both.**
The buyer does not see internal business data. The seller sees everything about their order. What one party provided as evidence is seen by both.

**7.5 Non-negotiable constraints recorded in the repository memory are not discussed or rephrased.**
They are consulted before designing. If an idea brushes against them, it is discarded without proposing variants.

---

## Step 8. Decide what information is kept

**8.1 Distinguish what was agreed from what is an instruction to act now.**
What is part of an agreement (address, recipient, products and prices of an order) is copied and does not change even if the business changes its configuration. What is an instruction to act right now (which number to pay to) is always shown current. For each piece of data, the document says which of the two it is.
- Example: the pickup point stays in the order even if the store moves; the wallet number the buyer sees when paying is the current one.
- Example: what a buyer types in an order stays in that order; it does not modify the contact record the seller has saved.

**8.2 Only the latest version of what was agreed is kept.**
Each change replaces the previous one. If it matters to know that something changed, it is noted; every version is not stored.

**8.3 The ephemeral is not stored.**
What does not survive the operation (a print job, a loaded list, an unconfirmed draft) is not kept. The minimum to recover from an interruption is stored: what was left in doubt and how to verify it.
- Do not: recoverable drafts, job histories, local queues in a first version.

**8.4 Distinguish what belongs to the device from what belongs to the account.**
A phone preference (the chosen printer) survives signing out. Account data is cleared on sign-out or stays tied to that account so another cannot see it.

**8.5 What identifies something is stable; what is displayed can change.**
A visible number, an alias or a network address serve to display or locate, not to identify. The document says by what each thing is recognized.

**8.6 The phone's storage belongs to the user.**
Files the product downloads or generates are private, temporary, bounded and deleted when no longer useful. Nothing goes to the gallery.

**8.7 If there are no real users, changes apply to everyone without transition.**
Check in the repository memory whether there are businesses operating in production. If there are none, no grace periods or conversions of previous data are designed.

---

## Step 9. Fix the vocabulary and the texts

**9.1 One name per concept, in the document and in the interface.**
One term is chosen for each thing and always used. If the interface shows a name different from the concept's, the document says so once and does not alternate.

**9.2 When two terms get confused, they are defined and the definition is written down.**
- Example: modality is how the buyer receives; coverage is which places are delivered to; rate is how much it costs.

**9.3 Things are named by what they do for the user, not by who provides them.**
«Print label», not the manufacturer's name; «Connect WhatsApp», not the library's name.

**9.4 Visible texts are written in the document, in angle quotes.**
Buttons, titles, empty states, messages and confirmations with their exact text. They are trimmed: half the words are usually unnecessary.

---

## Step 10. Defer clearly

**10.1 What does not go in is named with its trigger.**
Each deferred item says what unblocks it. An explicit limit is worth more than a half solution.
- Example: "Closing the app between confirming and receiving the response leaves the sale in doubt; it is verified on return. An offline mode waits until deferred sync is defined."

**10.2 Deferred items with real risk become tasks.**
If what is left out can cause loss, duplication or blocking, a task is created in the backlog and the document links it. What is only an improvement is listed in the document.

**10.3 What was already discarded or deferred is not proposed again.**
What was discarded is recorded in the repository memory and in the documents' "Closed decisions". It is not rephrased under another name. If there is a new reason, it is raised as a question in the final block, once, with the reason.

**10.4 Partial versions that later have to be undone are not built.**
Between "do it complete later" and "do half now", the first is chosen.

---

## Step 11. Decide what the agent decides and what it asks

The agent decides everything routine on its own and writes it down. It asks only what changes scope, money, what is kept, priorities between features or contradicts a previous decision. It asks with a recommendation.

### The agent decides and writes it down

- **Standard interface patterns of each platform:** tab versus entry on Home, «Load more» versus pages, editable screen versus detail with **Edit**, two-step flows with review, sheets for filters and selection, transient notices.
- **Context preservation and discard confirmations.**
- **Screen states and texts:** empty, loading, no results, error, too many; texts of buttons, messages and confirmations.
- **Behavior on failure:** the four outcomes of Step 6 applied to each action.
- **Account security defaults:** link expiries, closing other sessions, responses that do not reveal accounts.
- **What is copied and what is shown current,** following Step 8.
- **What is a device preference and what is account data.**
- **Initial calibration values:** timeouts, items per page, maximum sizes, marked as "initial value, adjustable". If memory or a current document already fixed an analogous value, it is reused.
- **What is already recorded in the repository memory or in a current document.** If the task contradicts memory, memory prevails and it is noted.
- **Facts verifiable in the application:** whether a screen, a filter, a capability exists. It is verified, not asked.

### Requires the founder

- **Scope of the first version:** which types, channels, platforms, countries, media or attachments go in; whether there is an offline mode; whether an edge case gets its own flow.
- **Real business facts that set defaults** and are not in memory: how often something happens, how many of something a typical business has, what delay is tolerated.
- **Meaning of a visible action:** what a button means for the buyer; whether an attachment is mandatory; who chooses between options; whether something can be changed after confirming.
- **Visible business rules that cannot be deduced from context:** which data is shown current or copied when Step 8 does not resolve it; whether a filter is by day or by date and time.
- **What is kept and who sees it** when Step 8 does not resolve it.
- **Priorities and order between features:** what goes in this task and what in another; in what order the slices are built.
- **User-visible naming** that fixes a new concept.
- **Anything that contradicts a previous decision.** The contradiction is exposed and asked about; it is never reintroduced on the agent's own initiative.

---

## Step 12. Present the result

**12.1 The document is delivered complete, with routine decisions already made and visible.**
Neither a skeleton nor a list of options is delivered. Every decision the agent made about something the founder might want to change appears under "Decided unless objected".

**12.2 Acceptance criteria are concrete scenarios.**
Each criterion describes a situation with data and an observable result, not a category.
- Example: "The buyer confirms an order whose total went from S/ 100.00 to S/ 95.00 while reading it: they see the new-total notice, the form keeps their data and the confirmation is not recorded until they confirm again."
- Do not: "Checkout errors are validated."

**12.3 Questions go in a single block, numbered, with a recommendation.**
Each question carries the context in one line, the recommended option first with its reason, the alternatives and the consequence of each in scope, data or effort, so it can be answered with a number. Separately, the "Decided unless objected" list.

```
Questions (answer with the option number):

1. Is the receipt mandatory to report a payment?
   (1) Mandatory. Recommended: cheap for the buyer and useful for verification.
   (2) Optional. Allows reporting without a receipt; the seller verifies without evidence.

2. Is the first version limited to a single country?
   (1) One country, one time zone. Recommended: no per-business configuration.
   (2) Several countries. Adds a time zone per business and its configuration.

Decided unless objected:
- The history shows twenty items per page with «Load more».
- Leaving with a built cart asks for confirmation; the cart is not recovered afterwards.
```

**12.4 A founder question like "what is X for?" is an objection.**
Answer in two lines and offer the version without X. X is not defended.

**12.5 A short message with two readings is rephrased and the agent asks which one it is.**
It is the only question asked before writing the document.
