# The Beast Bar - Project TODO

## Database and Schema
- [x] Quiz sessions table (id, answers JSON, recipe JSON, created_at)
- [x] Ingredients table (id, name, category, available bool)
- [x] Admin settings table (webhook_url, whatsapp_number)
- [x] Reviews table (name, text, rating, color)

## Backend / API
- [x] Admin auth procedure (username/password, cookie session)
- [x] Quiz session create/update procedures
- [x] Ingredient CRUD procedures (admin)
- [x] Claude AI cocktail generation procedure with flavor psychology
- [x] Webhook fire procedure (POST to configured URL)
- [x] Admin settings get/set procedures
- [x] Quiz sessions list procedure (admin)

## Landing Page
- [x] Three.js splashing liquid hero animation
- [x] Bold "The Beast Bar" branding
- [x] Colorful UGC fake reviews section (8 seeded reviews)
- [x] CTA button to start quiz
- [x] Mobile-optimised layout

## Quiz Flow
- [x] 10-question conversational quiz
- [x] Per-question 3D liquid splash transition animation
- [x] Answer storage per session in DB
- [x] Progress indicator
- [x] Mobile-first tap targets

## AI Cocktail Generation
- [x] Claude API integration with 15-principle flavor psychology system prompt
- [x] 3 cocktail variants generated per session
- [x] Ingredient filtering against admin DB
- [x] Milliliter-based measurements only

## Result Page
- [x] 3D cocktail glass visual (Three.js)
- [x] Recipe display (3 variants with selector)
- [x] Flavor profile explanation and badges
- [x] Webhook POST on completion
- [x] Ingredient list in ml

## Admin Panel
- [x] Login page (credentials via ADMIN_USERNAME / ADMIN_PASSWORD env vars)
- [x] Ingredient checklist database (pre-populated with 50+ ingredients)
- [x] Custom ingredient add/remove
- [x] Webhook URL configuration
- [x] Quiz sessions data viewer with expandable answers
- [x] Dashboard overview stats (available/unavailable counts)

## Polish
- [x] Remove all AI artifacts from copy
- [x] Colorful organic design throughout
- [x] Zero futuristic elements
- [x] Mobile optimisation pass
- [x] Performance check on 3D animations (THREE.Clock deprecated warning fixed)
- [x] All 6 vitest tests passing

## Polish Round 2 (June 18)
- [x] Remove pill badge from hero
- [x] Remove particle system from LiquidSplash3D (blobs only)
- [x] Reduce global border-radius to 0.375rem for professional look
- [x] Rebuild admin panel with sidebar layout, search, category grouping, toggle switches
- [x] Add order form to result page (email + phone, clear "real order" messaging)
- [x] Order confirmation state after submission
- [x] submitOrder backend procedure with webhook fire
- [x] orderEmail, orderPhone, orderSubmitted columns added to quiz_sessions
- [x] Replace review avatars with real Unsplash photos (6 women, 2 men)
- [x] All 6 vitest tests still passing
