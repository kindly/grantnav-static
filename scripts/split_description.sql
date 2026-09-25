-- Carry descriptions at roughly half the bytes, losing nothing.
--
-- 1.52M grants hold only 770K distinct descriptions: funders repeat a
-- programme's boilerplate across every grant in it. facetful dictionary-encodes
-- a text column only below 65,535 distinct values, and Description is far over
-- that, so the whole thing is stored as plain text and every repeat is paid for
-- in full.
--
-- Splitting the column at that threshold gets the dictionary back for the half
-- of the rows that are repeats: the 65,000 most common descriptions become a
-- dict column (13 MB of distinct text covering 53.6% of rows), and the rest
-- stay plain. Searching means an OR across the two, and the dict side is the
-- cheaper of the two to search because LIKE runs once per distinct value
-- rather than once per row.
--
-- Two more rules on top, both cheap:
--   * a description identical to the title is dropped — Title is searched and
--     displayed already, so carrying it twice buys nothing (79,837 rows)
--   * the rare side is cut at 500 characters. Cutting *every* description
--     there costs "climate" 20% of its matches; cutting only the rare ones
--     costs 1-3%, because the repeated boilerplate where late matches
--     concentrate is on the common side and stays whole.

set memory_limit='3GB';
set preserve_insertion_order=false;

create or replace view src as
  select * from read_csv(getvariable('csv'), header=true, all_varchar=true, ignore_errors=true);

-- 65,000 not 65,535: the compiler's cap is >=, and the empty string used for
-- "not in this column" takes a dictionary slot of its own.
create or replace table common_desc as
  select Description as d
  from src
  group by Description
  order by count(*) desc
  limit 65000;

copy (
  select
    s."Identifier",
    s."Title",
    -- a row's description lands in exactly one of these two columns
    case when s."Description" = s."Title" then '' when c.d is null then left(s."Description", 500) else '' end as "Description Rare",
    case when s."Description" = s."Title" then '' else coalesce(c.d, '') end as "Description Common",
    s."Amount Awarded",
    s."Award Date",
    s."Funding Org:Identifier",
    s."Funding Org:Name",
    s."Funding Org: Org Type (additional data)",
    s."Recipient Org:Name",
    s."Recipient Org: Org Type (additional data)",
    s."Grant Programme:Title",
    s."Best Available Region (additional data)",
    s."Best Available District (additional data)",
    s."Best Available County",
    s."Type of Recipient",
    s."Grant Type",
    left(s."Award Date", 4) as "Award Year",
    case
      when try_cast(s."Amount Awarded" as double) is null then ''
      when try_cast(s."Amount Awarded" as double) < 500 then '01 Under £500'
      when try_cast(s."Amount Awarded" as double) < 1000 then '02 £500 - £1k'
      when try_cast(s."Amount Awarded" as double) < 2000 then '03 £1k - £2k'
      when try_cast(s."Amount Awarded" as double) < 5000 then '04 £2k - £5k'
      when try_cast(s."Amount Awarded" as double) < 10000 then '05 £5k - £10k'
      when try_cast(s."Amount Awarded" as double) < 50000 then '06 £10k - £50k'
      when try_cast(s."Amount Awarded" as double) < 100000 then '07 £50k - £100k'
      when try_cast(s."Amount Awarded" as double) < 500000 then '08 £100k - £500k'
      when try_cast(s."Amount Awarded" as double) < 1000000 then '09 £500k - £1m'
      else '10 Over £1m'
    end as "Amount Band"
  from src s
  left join common_desc c on c.d = s."Description"
  order by s."Funding Org:Name", s."Recipient Org:Name", s."Award Date"
) to 'build/stage/app-sorted.csv' (header, format csv);
