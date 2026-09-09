export const structure = (S) =>
  S.list()
    .title('Съдържание')
    .items([
      S.documentTypeListItem('post').title('Статии'),
      S.documentTypeListItem('author').title('Автори'),
      S.documentTypeListItem('category').title('Категории'),
    ])
