# summary_bar
select count(*) as grants, sum("Amount Awarded") as total, count(distinct "Recipient Org:Name") as recipients from t

# facet_funder
select "Funding Org:Name", count(*) as n, sum("Amount Awarded") as amount from t group by "Funding Org:Name" order by n desc limit 20

# facet_region
select "Best Available Region (additional data)", count(*) as n from t group by "Best Available Region (additional data)" order by n desc

# facet_year
select year("Award Date") as yr, count(*) as n, sum("Amount Awarded") as amount from t group by yr order by yr

# facet_amount_bands
select case when "Amount Awarded" < 500 then 'a <500' when "Amount Awarded" < 1000 then 'b 500-1k' when "Amount Awarded" < 5000 then 'c 1k-5k' when "Amount Awarded" < 10000 then 'd 5k-10k' when "Amount Awarded" < 100000 then 'e 10k-100k' when "Amount Awarded" < 1000000 then 'f 100k-1m' else 'g 1m+' end as band, count(*) as n from t group by band order by band

# facet_programme
select "Grant Programme:Title", count(*) as n from t group by "Grant Programme:Title" order by n desc limit 20

# facet_district
select "Best Available District (additional data)", count(*) as n from t group by 1 order by n desc limit 30

# search_title
select count(*) from t where "Title" like '%youth%'

# search_description
select count(*) from t where "Description" like '%mental health%'

# search_free_text
select count(*) from t where "Title" like '%climate%' or "Description" like '%climate%'

# search_then_facet_region
select "Best Available Region (additional data)", count(*) as n, sum("Amount Awarded") as amount from t where "Description" like '%mental health%' group by 1 order by n desc

# search_then_facet_funder
select "Funding Org:Name", count(*) as n from t where "Description" like '%mental health%' group by 1 order by n desc limit 20

# results_page
select "Title", "Funding Org:Name", "Recipient Org:Name", "Amount Awarded", "Award Date" from t where "Description" like '%mental health%' order by "Award Date" desc limit 20

# results_page_by_amount
select "Title", "Funding Org:Name", "Recipient Org:Name", "Amount Awarded", "Award Date" from t where "Best Available Region (additional data)" = 'Scotland' order by "Amount Awarded" desc limit 20

# funder_page
select "Recipient Org:Name", count(*) as n, sum("Amount Awarded") as amount from t where "Funding Org:Name" = 'The National Lottery Community Fund' group by 1 order by amount desc limit 20

# recipient_lookup
select * from t where "Recipient Org:Name" like '%Oxfam%' limit 50

# multi_filter_facet
select "Grant Programme:Title", count(*) as n from t where "Best Available Region (additional data)" = 'London' and "Amount Awarded" >= 10000 and year("Award Date") >= 2020 group by 1 order by n desc limit 20

# pivot_region_year
select "Best Available Region (additional data)", year("Award Date") as yr, count(*) as n, sum("Amount Awarded") as amount from t where year("Award Date") between 2015 and 2024 group by 1, 2
