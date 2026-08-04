# ECONOMY STRESS TEST — Broadway & Wall

`pnpm stress` · 4 market seeds × 50 sim years · city seed 20261.

Companion to ECONOMY_AUDIT.md. That report asks whether a shock in one place moves the right things elsewhere. This one asks whether the world exists without the player, whether the player exists to the world, whether there is a dominant strategy, and whether the engine survives being pushed to its bounds.

## 28. STRATEGY TOURNAMENT — **BROKEN**

```
strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  holds
allcash      $331.5M      $116.8M      $208.1M      $637.5M      27.5%   0         43      34
maxlev       $323.0M      $97.2M       $-1.2M       $2.45B       63.1%   1         84      49
core         $133.1M      $42.9M       $-0.2M       $1.10B       69.1%   1         14      5
industrial   $32.0M       $11.1M       $-0.0M       $134.2M      55.6%   1         11      4
landbank     $2.2M        $0.7M        $-0.2M       $7.2M        71.2%   1         15      1
merchant     $-0.1M       $-0.1M       $-0.1M       $-0.1M       101.0%  4         2       0
valueadd     $-0.1M       $-0.1M       $-3.1M       $2.99B       58.1%   2         8       7
contrarian   $-2.1M       $-1.7M       $-2.4M       $279.1M      87.9%   2         6       4

strongest: allcash at $116.8M real · weakest: contrarian at $-1.7M
spread between best and worst strategy: 116770360.0x
```

