with total_cnt as (
    select  media_src,
                acc_create_os,
                sum(acc_create_count) as create_cnt
            from bi_dw.v_tb_account_gm_core_metrics_daily_all_game_v7
    where dt between '2025-05-01' and '2025-05-18'
    group by media_src, acc_create_os
    having sum(acc_create_count) > 2000
),