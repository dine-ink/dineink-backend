-- Onboarding means "we are still talking to them and no account exists yet".
--
-- The moment a restaurant has an account -- which is what owner-web's signup
-- creates -- they are past onboarding, whether or not they have taken a single
-- order. Order volume says nothing about onboarding state.
--
-- setupRestaurantService (the owner-web signup path) never sets platformStatus,
-- so every restaurant that signed up landed on the previous ONBOARDING default
-- and sat in the onboarding queue forever. The internal console's
-- createRestaurant sets LEAD explicitly, so leads are unaffected by this change
-- and still start as leads.
--
-- Changes the DEFAULT only. Existing rows are not touched here; they are
-- backfilled separately through the console's own service layer so each change
-- carries an audit record naming who made it and why.

ALTER TABLE "Restaurant" ALTER COLUMN "platformStatus" SET DEFAULT 'ACTIVE';
ALTER TABLE "Restaurant" ALTER COLUMN "onboardingStage" SET DEFAULT 'ACTIVE';
