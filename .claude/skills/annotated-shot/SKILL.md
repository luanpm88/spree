---
name: annotated-shot
description: Take a screenshot with the point drawn onto it, ready to attach to a WhatsApp message or a tracker comment. Use when showing a client something on a page — a bug, a change, a thing to decide — instead of describing it in words and hoping they find it.
---

# Annotated screenshot for a client

A bare screenshot makes the client hunt for the thing you are talking about. They scroll,
they guess, and often they answer a different question. Draw the callout into the image
and that step disappears.

The tool is `script/annotate_shot.mjs`. Edit its `SHOTS` array, run it, **look at every
image**, then hand the file paths over.

## The rule that matters

**Open every image before you hand it over.** Not the log line, the image.

Three separate times this has produced a file that reported `ok` and was useless:

- a Next dev error overlay, which returns HTTP 200 and looks like a page
- a label placed on top of the very paragraph it was pointing out
- a target scrolled off screen, so the callout was drawn outside the picture

Each guard is now in the script and each one exists because a bad file nearly went to a
client. The script fails loudly on all three. It still cannot tell you the shot is
pointless, or that the header says "Spree Store" instead of the client's name. Only
looking does that.

## Writing a shot

```js
{
  name: '3-submit-button',            // becomes tmp/annotated/3-submit-button.png
  url: `${BASE}/contact`,
  viewport: { width: 1440, height: 1000 },
  frameSelector: 'iframe',            // only if the target is inside a frame
  scrollTo: 'button[type="submit"]',  // bring it into view before measuring
  notes: [
    {
      frame: 'iframe',                // same: only for a target inside a frame
      selector: 'button[type="submit"]',
      text: 'Still default blue. The green rule targets input[type=submit],\nbut this renders as <button>, so it never matches.',
      tone: 'warn'                    // warn = orange, ok = green
    }
  ]
}
```

- `notes: []` is legitimate. A "here is your page" shot is better with nothing drawn on it.
- Number the names. They arrive in order in a chat and the order is the argument.
- The label text is what the client reads. Say the finding, not the file name.

## Cross-origin frames

Playwright drives the browser rather than running inside the page, so
`frameLocator().boundingBox()` measures an element in a frame from another origin. Page
JavaScript cannot. This is the whole reason the tool can point at a third-party embed.

## Before handing the paths over

1. Read every PNG.
2. Check the branding: a local instance shows placeholder names. Set the store name in
   `.env.local` so the client recognises their own shop rather than the starter's.
3. Check no callout covers the thing it points at.
4. Say which file goes with which message, in order.

## Where the files go

`tmp/annotated/`, which is gitignored. Screenshots of a client's shop are client material.
