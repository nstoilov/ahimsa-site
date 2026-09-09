import {defineArrayMember, defineField, defineType} from 'sanity'

export default defineType({
  name: 'blockContent',
  title: 'Съдържание',
  type: 'array',
  of: [
    defineArrayMember({
      type: 'block',
      styles: [
        {title: 'Нормален', value: 'normal'},
        {title: 'Заглавие 2', value: 'h2'},
        {title: 'Заглавие 3', value: 'h3'},
        {title: 'Заглавие 4', value: 'h4'},
        {title: 'Цитат', value: 'blockquote'},
      ],
      lists: [
        {title: 'Списък с точки', value: 'bullet'},
        {title: 'Номериран списък', value: 'number'},
      ],
    }),
    defineArrayMember({
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({
          name: 'alt',
          title: 'Alt текст',
          type: 'string',
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: 'caption',
          title: 'Подпис',
          type: 'string',
        }),
      ],
    }),
    defineArrayMember({
      name: 'codeBlock',
      title: 'Код',
      type: 'object',
      fields: [
        defineField({
          name: 'language',
          title: 'Език',
          type: 'string',
          options: {
            list: [
              {title: 'Plain text', value: 'plaintext'},
              {title: 'JavaScript', value: 'javascript'},
              {title: 'TypeScript', value: 'typescript'},
              {title: 'Bash', value: 'bash'},
              {title: 'JSON', value: 'json'},
              {title: 'HTML', value: 'html'},
              {title: 'CSS', value: 'css'},
              {title: 'Python', value: 'python'},
            ],
            layout: 'dropdown',
          },
          initialValue: 'plaintext',
        }),
        defineField({
          name: 'code',
          title: 'Код',
          type: 'text',
          rows: 8,
          validation: (rule) => rule.required(),
        }),
      ],
      preview: {
        select: {title: 'language', code: 'code'},
        prepare({title, code}) {
          return {title: `Код (${title || 'plaintext'})`, subtitle: code}
        },
      },
    }),
  ],
})
