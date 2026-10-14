import React from 'react'
import { getT } from './i18n'
import './About.css'

import sarifImg  from './assets/sarif.jpg'
import faisalImg from './assets/faisal.jpg'
import sameerImg from './assets/sameer.jpg'
import wasimImg  from './assets/wasim.jpg'

const TEAM = [
  {
    id: 1,
    nameKey: 'Mr Sarif Sk',
    roleKey: 'Frontend & Backend Developer',
    image: sarifImg,
    bioKey: 'Handles full-stack application architecture, connecting dynamic frontend user interfaces with core backend systems.',
  },
  {
    id: 2,
    nameKey: 'Mr Faisal Ansari',
    roleKey: 'Frontend & API Specialist',
    image: faisalImg,
    bioKey: 'Focuses on interactive client-side design and integration of real-time routing APIs.',
  },
  {
    id: 3,
    nameKey: 'Mr Sameer',
    roleKey: 'Backend Developer',
    image: sameerImg,
    bioKey: 'Manages server-side logic, database query structures, and routing algorithms.',
  },
  {
    id: 4,
    nameKey: 'Mr Wasim Ansari',
    roleKey: 'Frontend & Backend Developer',
    image: wasimImg,
    bioKey: 'Specializes in full-stack feature development, UI components, and seamless system integrations.',
  },
]

const TECHS = [
  { key: 'aboutTech1', descKey: 'aboutTech1Desc', icon: '🤖', color: '#3b82d4' },
  { key: 'aboutTech2', descKey: 'aboutTech2Desc', icon: '🗺️', color: '#0f766e' },
  { key: 'aboutTech3', descKey: 'aboutTech3Desc', icon: '🌍', color: '#16a34a' },
  { key: 'aboutTech4', descKey: 'aboutTech4Desc', icon: '🌡️', color: '#d97706' },
  { key: 'aboutTech5', descKey: 'aboutTech5Desc', icon: '⚡', color: '#7c3aed' },
]

export default function About({ onBack, lang = 'en' }) {
  const t = getT(lang)

  return (
    <div className="rahi-about-page">
      {/* Ambient glows */}
      <div className="about-glow glow-top" />
      <div className="about-glow glow-bottom" />

      {/* Back button */}
      <div className="about-nav-bar">
        <button type="button" className="btn-about-back" onClick={onBack}>
          {t('aboutBackBtn')}
        </button>
      </div>

      {/* Hero */}
      <header className="about-hero">
        <div className="about-badge">{t('aboutBadge')}</div>
        <h1 className="about-title">
          {t('aboutTitle')}
        </h1>
        <p className="about-description">{t('aboutDesc')}</p>
      </header>

      {/* 3 Feature highlights */}
      <section className="about-section">
        <div className="about-highlights-grid">
          <div className="about-card">
            <div className="about-card-icon">☀️</div>
            <h3>{t('aboutF1Title')}</h3>
            <p>{t('aboutF1Desc')}</p>
          </div>
          <div className="about-card">
            <div className="about-card-icon">🚨</div>
            <h3>{t('aboutF2Title')}</h3>
            <p>{t('aboutF2Desc')}</p>
          </div>
          <div className="about-card">
            <div className="about-card-icon">👥</div>
            <h3>{t('aboutF3Title')}</h3>
            <p>{t('aboutF3Desc')}</p>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="about-section about-mission-section">
        <div className="about-mission-card">
          <div className="about-mission-icon">🎯</div>
          <div>
            <h2 className="about-mission-title">{t('aboutMission')}</h2>
            <p className="about-mission-text">{t('aboutMissionDesc')}</p>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="about-section">
        <div className="section-title-wrap">
          <h2>{t('aboutTechTitle')}</h2>
        </div>
        <div className="about-tech-grid">
          {TECHS.map((tech) => (
            <div className="about-tech-card" key={tech.key} style={{ '--tech-color': tech.color }}>
              <span className="tech-icon">{tech.icon}</span>
              <div>
                <strong className="tech-name">{t(tech.key)}</strong>
                <p className="tech-desc">{t(tech.descKey)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Team */}
      <section className="about-section team-section">
        <div className="section-title-wrap">
          <h2>{t('aboutTeamTitle')}</h2>
          <p>{t('aboutTeamSub')}</p>
        </div>

        <div className="team-grid">
          {TEAM.map((member) => (
            <div className="team-card" key={member.id}>
              <div className="member-avatar-wrap">
                <img src={member.image} alt={member.nameKey} className="member-avatar" />
              </div>
              <h3 className="member-name">{member.nameKey}</h3>
              <span className="member-role">{member.roleKey}</span>
              <div className="member-qual-badge">🎓 {t('aboutQual')}</div>
              <p className="member-bio">{member.bioKey}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
