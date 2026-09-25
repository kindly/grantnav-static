# search_cold_then_facets
select count(*) as n, sum("Amount Awarded") as amt from t where ("Title" like '%mental health%' or "Recipient Org:Name" like '%mental health%' or "Grant Programme:Title" like '%mental health%' or "Description Common" like '%mental health%' or "Description Rare" like '%mental health%')

# then_facet_region
select "Best Available Region (additional data)", count(*) as n from t where ("Title" like '%mental health%' or "Recipient Org:Name" like '%mental health%' or "Grant Programme:Title" like '%mental health%' or "Description Common" like '%mental health%' or "Description Rare" like '%mental health%') group by 1 order by n desc

# then_facet_funder
select "Funding Org:Name", count(*) as n from t where ("Title" like '%mental health%' or "Recipient Org:Name" like '%mental health%' or "Grant Programme:Title" like '%mental health%' or "Description Common" like '%mental health%' or "Description Rare" like '%mental health%') group by 1 order by n desc limit 12

# then_page
select "Identifier", "Title", "Recipient Org:Name", "Amount Awarded", "Description Common", "Description Rare" from t where ("Title" like '%mental health%' or "Recipient Org:Name" like '%mental health%' or "Grant Programme:Title" like '%mental health%' or "Description Common" like '%mental health%' or "Description Rare" like '%mental health%') order by "Award Date" desc limit 50

# no_search_facet
select "Funding Org:Name", count(*) as n from t group by 1 order by n desc limit 12
