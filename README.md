# Glacite Lab

[Open the optimizer](https://exhaust-pipe.github.io/Glacite_Lab/) · **English** · [简体中文](./README.zh-CN.md)

Glacite Lab helps Hypixel SkyBlock players decide whether to open a Lapis, Tungsten, Umber or Vanguard corpse and which RNG Meter target to select. It estimates long-run net coins per mineshaft using market prices, your perk levels and a shared meter.

## Use the optimizer

1. Set your **Perk loadout**. Each level is editable. **No perks** and **Max perks** change the six perk settings together. A first visit starts with max perks and an English interface.
2. Under **Market prices**, choose how you buy keys and sell loot. Expand **Fees and model assumptions** to set taxes, the Fairy mineshaft share, crystal locks, the unknown Vanguard chestplate weight and guarantee eligibility.
3. Enter your current **Shared RNG Meter** XP. Each row gives the recommended action and the marginal value of opening that corpse. **Open · Bank XP** leaves the target unselected. **Target** means opening with the named drop selected.
4. Use the **RNG policy map** to see where the action changes as XP accumulates. Its table lists the inclusive grid intervals. The current decision evaluates your exact XP, including guarantee thresholds between grid points.

The page recalculates after changes. Switching between **EN** and **中文** keeps your inputs and the current solution. This browser remembers your language, settings, XP and price overrides.

## Perks and defaults

| Setting | Range | Effect in the model |
| --- | --- | --- |
| Resourceful | 0–5 | Each level gives a 1% chance to keep the key. |
| Gifts from the Departed | 0–100 | Each effective level adds 0.2 percentage points to the chance of one extra loot roll. |
| Dead Man’s Chest | 0–50 | Each effective level adds 0.5 percentage points to the chance of one extra corpse in a regular mineshaft. |
| Corpse milestone | None, I–VII | II and V each add 10 points to the extra-corpse chance. III and VI each add 10 points to the extra-roll chance. |
| Blue Cheese Goblin Omelette | Off / on | Adds one effective level to each learned HotM perk above, including at its trained cap. A level-zero perk stays locked. |
| Pity | 0–10 | Each level adds 1% to corpse RNG Meter XP. |

A regular shaft starts with two corpses and a 50% chance for a third. With all six settings maximized, the expected regular-shaft count is **2.955**, the extra-roll chance is **40.2%**, and keys are consumed **95%** of the time. With all perks off, those values are **2.5**, **0%** and **100%**. A Fairy shaft contains one Vanguard. Its default scenario share is 8.6%.

## Prices

The browser fetches Bazaar order books and the NPC item catalog from Hypixel. Instant Buy and Sell Offer use the lowest ask. Instant Sell and Buy Order use the highest bid. Auction House items use SkyHelper prices with Coflnet lowest BIN as a fallback. An AH listing or Bazaar order represents a quote; the eventual fill can differ.

Sale proceeds use the greater of the NPC floor and the market quote after tax. The default Bazaar sale tax is 1.125% and the estimated AH fee is 3%. An item override supplies a positive, pre-tax unit price for both purchase and sale. Clear the field to resume market pricing.

Opening the page requests fresh prices. Automatic updates run every 60 seconds while the page is visible and the solver is idle. **Refresh prices** requests an update immediately. A dated snapshot supplies the initial 39 item quotes on first use. On later visits, the browser can use saved quotes while refreshing. The status shows the Bazaar timestamp and identifies delayed data or unavailable feeds. A successful empty order book clears that side. An unresolved required sale or key purchase price pauses the solver and is marked in the price table.

## Model

- The solver compares skipping, opening with an unselected meter, and opening with each eligible target. It weights the four observed corpse types by their expected encounters per shaft. **Opening value** includes the change in future meter value. **Base profit** is expected unboosted-target loot less expected key cost.
- Base rolls are uniformly distributed over 3–6 for Lapis, 4–7 for Tungsten and Umber, and 5–8 for Vanguard. The extra-roll chance mixes the base roll distribution with one additional roll. Pity scales the respective base XP awards of 500, 2,500, 2,500 and 25,000.
- Stored XP multiplies the selected bundle weight by `1 + min(2 × stored XP / required XP, 2)`. The pool is renormalized. Stack sizes contribute to sale value. Frostbitten Dye replaces a normal roll and its meter boost is approximated by scaling the odds. The model resets XP at corpse settlement after a natural target hit below threshold. A guarantee replaces one roll with one target item, spends its required XP and then awards the corpse XP.
- A Web Worker uses relative value iteration with a coarse starting grid, then solves at **2,500 XP** steps through **5,050,000 XP** with linear interpolation. The displayed profit interval comes from the final Bellman residuals. Its width describes numerical uncertainty in the discrete model. **Best redemption rate** is net sale value per required XP and can differ from the recommended target.
- Regular encounters use 50% Lapis, 25% Tungsten and 25% Umber. Locked crystals are excluded. Unlocked crystals retain weight and have zero coin value. Tungsten/Umber weights sum to 6,440 locked and 6,640 unlocked. The default Vanguard chestplate weight is zero because its weight is unknown. The default guarantee requires an eligible loot pool; the any-corpse option is experimental.
- The objective covers coins from corpses and keys. It omits travel time, powder valuation, one-time milestone rewards, order slippage and capital constraints.

## Run locally

The site uses static HTML, CSS and JavaScript modules. From the repository root, run a local HTTP server and open [localhost:8000](http://localhost:8000/).

```sh
python3 -m http.server 8000
```

Run the regression suite with Node.js 18 or newer. The page and tests have no npm dependencies.

```sh
node --test
```

GitHub Pages serves the root of `main`. `js/data.js` holds the bundles and targets, `js/model.js` implements the solver, `js/market.js` resolves quotes, and `js/i18n.js` contains the interface translations.

## Sources and license

[Frozen Corpses](https://hypixelskyblock.minecraft.wiki/w/Frozen_Corpses) · [RNG Meters](https://hypixelskyblock.minecraft.wiki/w/RNG_Meter) · [Blue Cheese Goblin Omelette](https://hypixelskyblock.minecraft.wiki/w/Blue_Cheese_Goblin_Omelette) · [Hypixel API](https://api.hypixel.net/) · [SkyHelper Prices](https://github.com/SkyHelperBot/Prices) · [Coflnet API](https://sky.coflnet.com/wiki/api)

Independent fan project. Code is distributed under the [GNU AGPL v3](./LICENSE). The bundled DM Sans font uses the [SIL Open Font License](./assets/DM-Sans-OFL.txt).
