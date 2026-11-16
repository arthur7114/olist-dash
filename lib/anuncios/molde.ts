// Molde de anúncio por família: o que o "Vender um igual" copia do anúncio modelo.
// Primeiro molde: amortecedor da tampa traseira (marca SW), a partir do Argo
// (MLB5184042761 unitário, MLB5169195009 par), conferido pela API em 14/11/2026.

export type Formato = "unidade" | "par"

// Fotos na ordem do anúncio: as do carro trocam por SKU, as fixas são as genéricas do modelo.
export type FotoSlot = { tipo: "carro" | "medidas" | "aplicacao" } | { fixa: string }

export type MoldeFormato = {
  itemModelo: string
  preco: number
  skuSufixo: string
  unidadesPorPack: number
  saleFormat: "Unidade" | "Kit"
  tituloPrefixos: string[] // do mais completo ao mais curto, para caber em 60 caracteres
  descricaoPrefixo: string
  fotos: FotoSlot[]
  posicao: { valueId: string; valueName: string } | null // restrição de posição nas compatibilidades
  gtin: "olist" | "sem_gtin"
}

export type Molde = {
  familia: string
  nome: string
  categoriaId: string
  tipoAnuncio: string
  marcaPeca: string
  modeloPrefixo: string
  posicaoAutomotiva: string
  formatos: Record<Formato, MoldeFormato>
  caudaDescricao: string
}

const ml = (id: string, ext = "jpg") => `https://http2.mlstatic.com/D_${id}-O.${ext}`

const CAUDA = `***PRODUTO NOVO, COM NOTA FISCAL E GARANTIA.***

***IMPORTANTE - A MÁ INSTALAÇÃO OU MAU USO DO PRODUTO NOS ISENTA DE RESPONSABILIDADES, PARA EVITAR TRANSTORNOS PROCURE POR UM PROFISSIONAL ESPECIALIZADO.***

--------------------------------------------------------------------------------------------------------------------------------------
Bem-vindo à OEM PARTS!
Oferecemos soluções de qualidade para manter seu veículo sempre em perfeito funcionamento. Somos referência em peças de qualidade e atendimento especializado. Trabalhamos com autopeças originais para diversas marcas e modelos, garantindo a durabilidade e o desempenho que seu carro precisa. Nossa equipe está pronta para orientar você na escolha das peças certas, com foco na confiança e satisfação do cliente. Na OEM PARTS, você encontra o que precisa para manter seu veículo em excelente estado, com produtos selecionados e suporte técnico especializado.`

const TRASEIRA = { valueId: "13701105", valueName: "Traseira" }

export const MOLDE_AMORTECEDOR_TAMPA: Molde = {
  familia: "amortecedor-tampa",
  nome: "Amortecedor da tampa traseira",
  categoriaId: "MLB194779",
  tipoAnuncio: "gold_special", // Clássico
  marcaPeca: "SW",
  modeloPrefixo: "Amortecedor da Tampa Mala Traseira",
  posicaoAutomotiva: "Tampa Porta Mala Traseiro",
  caudaDescricao: CAUDA,
  formatos: {
    unidade: {
      itemModelo: "MLB5184042761",
      preco: 39.9,
      skuSufixo: "",
      unidadesPorPack: 1,
      saleFormat: "Unidade",
      tituloPrefixos: ["Amortecedor Porta Mala Traseira", "Amortecedor Tampa Traseira"],
      descricaoPrefixo: "AMORTECEDOR PORTA MALA TRASEIRA",
      fotos: [
        { tipo: "carro" },
        { fixa: ml("661812-MLB117144720637_092026") }, // "Evite erro na compra"
        { fixa: ml("741813-MLB114304153184_082026") }, // produto com logo
        { tipo: "medidas" },
        { fixa: ml("843113-MLB110978714822_052026") }, // produto
        { tipo: "aplicacao" },
        { fixa: ml("605582-MLB114305240204_082026", "webp") }, // qualidade e durabilidade
      ],
      posicao: null,
      gtin: "olist",
    },
    par: {
      itemModelo: "MLB5169195009",
      preco: 67.45,
      skuSufixo: " - PAR",
      unidadesPorPack: 2,
      saleFormat: "Kit",
      tituloPrefixos: ["Par Amortecedor Tampa Mala Traseira", "Par Amortecedor Tampa Traseira"],
      descricaoPrefixo: "PAR AMORTECEDOR PORTA MALA TRASEIRA",
      fotos: [
        { tipo: "carro" },
        { fixa: ml("699074-MLB115550978448_082026") }, // "Evite erro na compra"
        { tipo: "medidas" },
        { fixa: ml("929131-MLB111949540523_052026") }, // par com logo
        { tipo: "aplicacao" },
        { fixa: ml("843113-MLB110978714822_052026") }, // produto
        { fixa: ml("881620-MLB111950729617_052026") }, // "Leve o par"
      ],
      posicao: TRASEIRA,
      gtin: "sem_gtin",
    },
  },
}

export const MOLDES: Record<string, Molde> = { [MOLDE_AMORTECEDOR_TAMPA.familia]: MOLDE_AMORTECEDOR_TAMPA }
