'use client';
import { INVESTOR_QUESTIONS, profileWarningText, type ProfileAssessment, type ProfileLanguage } from '@/lib/investor-profile';
export function InvestorProfileSummary({ profile, language = 'en' }: { profile: ProfileAssessment; language?: ProfileLanguage }) {
  const pt = language === 'pt';
  return <section className="card glass-panel" aria-label={pt ? 'Avaliação do perfil do investidor' : 'Investor profile assessment'}>
    <h3>{pt ? 'Seu perfil calculado' : 'Your calculated profile'}</h3>
    <dl className="metric-grid">
      <div className="metric-card"><dt>{pt ? 'Pontuação' : 'Score'}</dt><dd>{profile.score}/75</dd></div>
      <div className="metric-card"><dt>{pt ? 'Categoria do guia' : 'Guide category'}</dt><dd>{pt ? ({ income: 'Renda', balanced: 'Equilibrado', growth: 'Crescimento' }[profile.category]) : profile.category}</dd></div>
      <div className="metric-card"><dt>{pt ? 'Ações sugeridas no guia' : 'Stocks in the guide'}</dt><dd>{profile.suggestedAllocation.stocks}%</dd></div>
      <div className="metric-card"><dt>{pt ? 'Renda fixa sugerida no guia' : 'Bonds in the guide'}</dt><dd>{profile.suggestedAllocation.bonds}%</dd></div>
    </dl>
    <p className="note">{pt ? 'O score soma suas respostas; não é confiança da IA, probabilidade de retorno nem certificação de adequação. O framework usa pressupostos de ações/renda fixa dos EUA e serve como orientação geral. Renda fixa também pode perder valor. Circunstâncias e pressupostos mudam: refaça o perfil quando necessário.' : 'The score adds your answers; it is not AI confidence, a return probability or a suitability certification. The framework uses U.S. stock/bond assumptions and is a general guide. Bonds can also lose value. Reassess when circumstances or assumptions change.'}</p>
    {profile.warnings.length > 0 && <div className="caveat"><strong>{pt ? 'Pontos para revisar' : 'Points to review'}</strong><ul>{profile.warnings.map(code => <li key={code}>{profileWarningText(code, language)}</li>)}</ul></div>}
    <details><summary>{pt ? 'Respostas e cálculo' : 'Answers and calculation'}</summary><ol>{profile.breakdown.map(answer => {
      const question = INVESTOR_QUESTIONS.find(q => q.id === answer.id)!;
      const index = answer.answer.charCodeAt(0) - 65;
      return <li key={answer.id}><strong>{pt ? question.pt : question.question}</strong><p>{answer.answer}: {(pt ? question.optionsPt : question.options)[index]} · {answer.points} {pt ? 'pontos' : 'points'}</p></li>;
    })}</ol><p className="note">Vanguard Investor Questionnaire (2022): {pt ? 'pontuação, página 6; composição, página 7. Tradução adaptada; ordem e pontos preservados.' : 'answer key, page 6; allocation guide, page 7. Adapted wording; answer order and points preserved.'}</p></details>
  </section>;
}
