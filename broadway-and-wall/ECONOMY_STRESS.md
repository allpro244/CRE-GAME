# ECONOMY STRESS TEST — Broadway & Wall

`pnpm stress` · 4 market seeds × 50 sim years · city seed 20261.

Companion to ECONOMY_AUDIT.md. That report asks whether a shock in one place moves the right things elsewhere. This one asks whether the world exists without the player, whether the player exists to the world, whether there is a dominant strategy, and whether the engine survives being pushed to its bounds.

## 28. STRATEGY TOURNAMENT — **WEAK**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  sold  holds
allcash      $331.5M      $116.8M      $208.1M      $637.5M      27.5%   0         43      6     34
maxlev       $323.0M      $97.2M       $-1.2M       $2.45B       73.4%   1         84      7     52
core         $133.1M      $42.9M       $-0.2M       $1.10B       69.1%   1         14      3     5
industrial   $32.0M       $11.1M       $-0.0M       $134.2M      55.6%   1         11      2     4
merchant     $2.8M        $1.2M        $-1.3M       $110.8M      92.4%   1         2       0     1
landbank     $2.2M        $0.7M        $-0.2M       $7.2M        71.2%   1         15      5     1
valueadd     $-0.1M       $-0.1M       $-3.1M       $1.59B       53.1%   2         8       0     7
contrarian   $-2.1M       $-1.8M       $-2.5M       $279.1M      87.9%   2         6       2     4

strongest: allcash at $116.8M real · weakest: contrarian at $-1.8M
the field (median strategy): $1.2M real
top strategy over the field: 98.50x   (need <= 4x)
top strategy wins 1 of 4 worlds outright: 25.0%   (need <= 70% — one right answer is a solved game)
strategies that end in the black: 5 of 8
```

