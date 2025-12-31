with total_cnt as 
(select media_src,acc_create_os,sum(acc_create_count) as create_cnt
from bi_dw.v_tb_account_gm_core_metrics_daily_all_game_v7
where dt between '2025-05-01' and '2025-05-18'
group by media_src,acc_create_os
having sum(acc_create_count)>2000),
media_cnt as 
(select media_src,
       sum(case when acc_create_os = 'android' then 1 else 0 end) as android_cnt,
       sum(case when acc_create_os = 'ios' then 1 else 0 end) as ios_cnt,
       sum(case when acc_create_os = 'win' then 1 else 0 end) as win_cnt
from total_cnt
group by media_src)
select media_src,
       case when android_cnt>0 and ios_cnt=0 and win_cnt=0 then 'android'
            when ios_cnt>0 and android_cnt=0 and win_cnt=0 then 'ios'
            when win_cnt>0 and android_cnt=0 and ios_cnt=0 then 'win'
            end as exclusive_os
from media_cnt
where (android_cnt>0 and ios_cnt=0 and win_cnt=0) or (ios_cnt>0 and android_cnt=0 and win_cnt=0) or (win_cnt>0 and android_cnt=0 and ios_cnt=0)
;