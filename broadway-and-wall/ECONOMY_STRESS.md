# ECONOMY STRESS TEST — Broadway & Wall

`pnpm stress` · 4 market seeds × 50 sim years · city seed 20261.

Companion to ECONOMY_AUDIT.md. That report asks whether a shock in one place moves the right things elsewhere. This one asks whether the world exists without the player, whether the player exists to the world, whether there is a dominant strategy, and whether the engine survives being pushed to its bounds.

## 28. STRATEGY TOURNAMENT — **BROKEN**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  holds
allcash      $322.6M      $138.3M      $117.7M      $872.0M      36.6%   0         46      39
core         $184.9M      $62.8M       $-0.2M       $432.0M      53.3%   1         16      8
industrial   $93.5M       $33.1M       $71.9M       $208.9M      34.1%   0         13      4
maxlev       $85.4M       $28.7M       $-0.1M       $1.03B       78.6%   1         30      11
valueadd     $8.2M        $2.8M        $-3.4M       $1.71B       80.2%   1         21      7
landbank     $5.0M        $1.7M        $2.1M        $11.8M       62.1%   0         17      4
merchant     $-0.1M       $-0.1M       $-0.1M       $-0.1M       76.5%   4         4       0
contrarian   $-0.2M       $-0.1M       $-1.6M       $651.6M      75.7%   2         6       2

strongest: allcash at $138.3M real · weakest: contrarian at $-0.1M
spread between best and worst strategy: 138333510.6x
```

## 32. NUMERICAL HYGIENE — **WIRED**

```
no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.
```

