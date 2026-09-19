# Secure Lo-Fi Study Cafe — UI/UX Enhancement Report

**Version:** 3.0

## Purpose

This update modernizes the Secure Lo-Fi Study Cafe without changing its security-first architecture. The goal was to make the interface feel warmer, easier to scan, more social, and more usable on phones while preserving the existing authentication, moderation, audit, music, and role-based controls.

## Research used

The redesign followed accessibility guidance rather than relying only on visual preference.

* **WCAG text contrast:** normal text should provide at least a 4.5:1 contrast ratio against its background, while large text may use 3:1.  
  Source: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
* **WCAG reflow:** non-exempt content should remain usable at a viewport equivalent to 320 CSS pixels without requiring horizontal page scrolling.  
  Source: https://www.w3.org/WAI/WCAG21/Understanding/reflow
* **WCAG pointer targets:** interactive pointer targets should be at least 24 × 24 CSS pixels unless a documented exception applies. The refreshed café intentionally uses larger controls, generally 44–46 CSS pixels high, for easier touch use.  
  Source: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
* **Reduced motion:** non-essential animation should respect the user's operating-system motion preference.  
  Source: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion

## Visual redesign

### Authentication experience

The login and registration screens now use the same animated coffee identity and warmer glass-like café card styling as the main room. The mobile layout keeps the form single-column with large controls and avoids horizontal overflow.

### Warmer café atmosphere

The old layout used large flat dark-brown surfaces with limited visual depth. The refreshed design uses:

* layered espresso, amber, lavender, and muted green background glows;
* softer translucent café panels;
* warmer cream text instead of harsh pure white;
* clearer separation between primary and secondary actions;
* more generous spacing and line height;
* softened borders and shadows;
* distinct focus indicators for keyboard users;
* improved hierarchy between section labels, titles, metadata, and actions.

No external tracking or background-image service was added. The atmosphere is built with CSS gradients and native styling.

### Animated coffee mark

The header now includes a coffee-cup identity mark with three subtle steam trails.

The steam is decorative only and automatically stops when the browser reports:

```css
@media (prefers-reduced-motion: reduce)
```

This keeps the animation ambient rather than essential.

## Interactive Café Floor

A new **Café Floor** panel provides a lightweight social-presence layer.

### How it works

Every connected user receives:

* a visible avatar;
* a username label;
* an online/controller state indicator;
* an in-room X/Y position;
* one of six avatar themes:
  * Latte
  * Mocha
  * Matcha
  * Berry
  * Sky
  * Lavender

New Socket.IO users automatically appear on the café floor.

### Movement

The current user can move their avatar with:

* Arrow keys
* WASD
* On-screen directional buttons
* Clicking/tapping a destination on the café floor

Movement is bounded inside the room.

The full Node.js app sends the user's X/Y room position through Socket.IO and broadcasts updated presence state to connected clients. Movement is held in server memory only and is not persisted to the database.

### Avatar customization

Users can select one of six visual avatar themes from the toolbar. In the live Node application the selected style is shared with other connected users for the current room session.

### Privacy decision

Avatar movement is intentionally **not** added to the permanent audit trail.

This is a deliberate data-minimization decision. The position is transient social UI state and is not necessary for authentication, moderation, incident review, or security accountability. Logging every movement would create noisy records without meaningful administrative value.

## Café floor visual elements

The room itself is rendered with CSS rather than external graphics. It includes:

* night window and moon;
* café lamps;
* wooden floor pattern;
* small café tables;
* coffee/book props;
* rug;
* avatar shadows and name bubbles.

This keeps the portfolio self-contained and avoids third-party asset dependencies.

## Mobile responsiveness

The refreshed layout was redesigned for small screens rather than merely shrinking the desktop page.

### Desktop

* Two-column café layout.
* Player/music controls on the left.
* Social floor and chat on the right.

### Tablet / narrow desktop

Below approximately 1040 CSS pixels:

* the application collapses to one readable column;
* the maximum width narrows for easier reading;
* content stays centered.

### Mobile

Below approximately 720 CSS pixels:

* top navigation stacks;
* primary actions use a two-column touch layout;
* the avatar room receives a fixed usable minimum height;
* avatar controls wrap below the room;
* chat height is reduced to avoid excessive scrolling;
* forms and controls remain large enough for touch use.

Below approximately 460 CSS pixels:

* actions become single-column;
* decorative header elements are reduced;
* café-floor furniture is simplified;
* avatars remain readable;
* controls remain at least approximately 46 CSS pixels high;
* the page avoids horizontal content scrolling.

## Keyboard and focus accessibility

The Café Floor is keyboard-focusable.

When focused:

* Arrow keys move the current avatar.
* WASD also moves the current avatar.

Interactive controls now receive a visible amber focus outline. This helps users navigate the site without relying on a mouse.

## Existing security behavior preserved

The redesign does not remove or weaken the existing controls:

* bcrypt password hashing;
* Express sessions;
* CSRF checks;
* role-based access control;
* permanent-admin restrictions;
* temporary moderator/controller logic;
* profanity filtering for non-admin users;
* Socket.IO session authentication;
* SQL parameterization;
* rate limiting;
* Helmet security headers;
* admin audit logging;
* soft-delete message moderation;
* CSV formula-injection protection.

## Admin console impact

The permanent admin still has access to the same café functionality plus the separate Admin Console.

The avatar room does not create additional personal-data collection. Administrators can see who is currently online through normal presence, but movement coordinates are not written to the audit database.

## Files changed

### Full Node application

* `server.js`
  * Added avatar-style definitions.
  * Added bounded X/Y avatar state to online presence.
  * Added Socket.IO `member:move` and `member:avatar` events.
  * Presence updates now include avatar position and style.

* `views/cafe.ejs`
  * Added animated coffee header mark.
  * Added Café Floor section.
  * Added avatar selection controls.
  * Added keyboard/touch movement controls.

* `public/cafe.js`
  * Renders all connected members as room avatars.
  * Synchronizes avatar movement through Socket.IO.
  * Supports keyboard and button movement.
  * Supports avatar-theme changes.

* `public/style.css`
  * Added new cozy color system.
  * Added layered café background.
  * Added coffee steam animation.
  * Added interactive room styling.
  * Added avatar styling and status indicators.
  * Added responsive breakpoints.
  * Added mobile touch layouts.
  * Added reduced-motion support.
  * Added stronger keyboard-focus states.

### GitHub Pages interface showcase

* `demo/cafe.html`
  * Added the same coffee identity and Café Floor UI.

* `demo/demo.js`
  * Added local interactive avatar movement and theme selection.
  * Demonstrates the interaction locally in the browser; cross-user synchronization is provided only by the Node.js/Socket.IO backend.

## Validation

The existing GitHub Actions workflow checks JavaScript syntax and compiles the EJS templates after changes.

The full live multi-user behavior belongs to the Node.js/Socket.IO application. GitHub Pages is static, so avatar state in that build is browser-local rather than synchronized across visitors.

## Future production improvements

For a production deployment, sensible next iterations would include:

1. Persisting the selected color/avatar theme in addition to the now-persistent profile picture.
2. Adding optional user status such as "studying", "break", or "listening".
3. Adding room capacity and multiple study rooms.
4. Adding an explicit animation toggle in addition to operating-system reduced-motion support.
5. Running automated accessibility checks such as axe-core in CI.
6. Adding end-to-end viewport tests for 320 px mobile, tablet, and desktop layouts.


## Profile pictures

Users can now upload a profile picture for their café avatar.

### Full Node application

The profile picture is persisted with the user account in SQLite. Socket.IO presence broadcasts only a small authenticated profile-image URL, while the actual image is fetched separately from the application. This prevents large base64 images from being resent with every movement/presence update.

The upload path is intentionally constrained:

* accepted formats: PNG, JPEG, and WebP only;
* maximum decoded file size: 512 KB;
* SVG is rejected;
* the server validates both the data-URL MIME type and the binary file signature before accepting the image;
* the normalized image is stored as account profile data;
* profile images are served through a login-protected application route;
* presence packets contain only a small profile-image URL/version rather than the full image;
* the image is shown on both the Café Floor avatar and the Members in Room list;
* only the fact that a profile image was updated or removed is written to the audit log — the image itself is not copied into audit records.

This avoids introducing an unrestricted filesystem upload endpoint while still providing persistent profile imagery.

### GitHub Pages demo

Because GitHub Pages has no backend database, the demo stores the selected profile image in that browser's local storage. It is therefore a portfolio demonstration of the UI rather than a multi-user persistent upload service.

## Smoother walking

Avatar movement was changed from discrete five-unit jumps to an animation-loop movement model.

Users can now:

* hold WASD;
* hold the arrow keys;
* press and hold the on-screen movement controls;
* click or tap a destination and watch the avatar walk toward it.

Movement is calculated from elapsed animation-frame time, which produces a consistent walking speed instead of depending on keyboard repeat rate.

The local avatar is animated directly with requestAnimationFrame, while remote avatars interpolate between throttled Socket.IO position updates. This gives the current user responsive movement without flooding the network, while other users still see smooth motion.

A subtle walking/bobbing animation is applied while movement is active. It is disabled under `prefers-reduced-motion: reduce`.

## Avatar speech bubbles

Live chat is now connected visually to the Café Floor.

When a user sends a chat message:

1. the normal chat record appears in Study Chat;
2. the same displayed message temporarily appears in a speech bubble above that user's avatar;
3. the bubble disappears automatically after approximately five seconds.

For non-admin users, the speech bubble uses the already-censored message returned by the server, so profanity filtering is not bypassed by the avatar UI.

Speech-bubble text is inserted with `textContent`, not HTML, which preserves the application's XSS-resistant rendering model.

## Additional files and schema changes

* `database.js`
  * added the `users.avatar_image` profile field and migration.

* `schema.sql`
  * documents the profile-image field.

* `server.js`
  * validates and persists profile image data;
  * exposes profile imagery through presence state;
  * accepts profile-image update/removal events;
  * preserves transient avatar movement as non-audited room state.

* `views/cafe.ejs`
  * added profile-picture upload/removal controls.

* `public/cafe.js`
  * added profile-image rendering;
  * added continuous walking and click-to-walk behavior;
  * throttles live movement updates;
  * added temporary avatar speech bubbles.

* `demo/cafe.html` and `demo/demo.js`
  * mirror the new profile, walking, and speech-bubble experience for the static portfolio build.

* `public/style.css`
  * added circular/cropped profile images;
  * walking animation;
  * speech-bubble styling;
  * responsive upload controls;
  * reduced-motion overrides for the new animations.
