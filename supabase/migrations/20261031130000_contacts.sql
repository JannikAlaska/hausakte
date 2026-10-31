-- Contacts (business cards, craftsmen, authorities) live in their own collection.
alter table public.hausakte_docs drop constraint hausakte_docs_collection_check;
alter table public.hausakte_docs add constraint hausakte_docs_collection_check
  check (collection in ('house', 'floors', 'components', 'projects', 'readings', 'documents', 'underlays', 'notes', 'contacts'));
