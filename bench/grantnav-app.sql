# summary_bar
select count(*) as grants, sum("Amount Awarded") as total from t

# facet_funder
select "Funding Org:Name", count(*) as n, sum("Amount Awarded") as amount from t group by 1 order by n desc limit 20

# facet_region
select "Best Available Region (additional data)", count(*) as n from t group by 1 order by n desc

# facet_year_derived
select "Award Year", count(*) as n, sum("Amount Awarded") as amount from t group by 1 order by 1

# facet_year_scalar
select year("Award Date") as yr, count(*) as n from t group by yr order by yr

# facet_amount_band_derived
select "Amount Band", count(*) as n from t group by 1 order by 1

# facet_programme
select "Grant Programme:Title", count(*) as n from t group by 1 order by n desc limit 20

# facet_district
select "Best Available District (additional data)", count(*) as n from t group by 1 order by n desc limit 30

# facet_org_type
select "Recipient Org: Org Type (additional data)", count(*) as n from t group by 1 order by n desc

# search_title
select count(*) from t where "Title" like '%mental health%'

# search_recipient
select count(*) from t where "Recipient Org:Name" like '%Oxfam%'

# search_then_facet_region
select "Best Available Region (additional data)", count(*) as n, sum("Amount Awarded") as amount from t where "Title" like '%mental health%' group by 1 order by n desc

# search_then_facet_funder
select "Funding Org:Name", count(*) as n from t where "Title" like '%mental health%' group by 1 order by n desc limit 20

# search_then_facet_year
select "Award Year", count(*) as n from t where "Title" like '%mental health%' group by 1 order by 1

# results_page
select "Identifier", "Title", "Funding Org:Name", "Recipient Org:Name", "Amount Awarded", "Award Date" from t where "Title" like '%mental health%' order by "Award Date" desc limit 20

# results_page_by_amount
select "Identifier", "Title", "Recipient Org:Name", "Amount Awarded" from t where "Best Available Region (additional data)" = 'Scotland' order by "Amount Awarded" desc limit 20

# funder_page
select "Recipient Org:Name", count(*) as n, sum("Amount Awarded") as amount from t where "Funding Org:Name" = 'The National Lottery Community Fund' group by 1 order by amount desc limit 20

# multi_filter_facet
select "Grant Programme:Title", count(*) as n from t where "Best Available Region (additional data)" = 'London' and "Amount Awarded" >= 10000 and "Award Year" >= 2020 group by 1 order by n desc limit 20

# pivot_region_year
select "Best Available Region (additional data)", "Award Year", count(*) as n, sum("Amount Awarded") as amount from t where "Award Year" between 2015 and 2024 group by 1, 2

# recipients_directory
select "Recipient Org:Name", count(*) as n, sum("Amount Awarded") as amount from t group by 1 order by amount desc limit 100
