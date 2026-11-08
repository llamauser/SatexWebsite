/**
 * PROVISIONAL legal texts (docs/11-non-functional.md §6). They describe how the system really works but MUST be reviewed by a
 * lawyer for the applicable country before launch. Placeholders: {company}, {email}.
 */
export type LegalDoc = "privacy" | "terms";
export interface LegalSection { title: string; body: string[] }
export interface LegalContent { title: string; notice: string; updated: string; sections: LegalSection[] }
type Locale = "fr" | "en" | "ar";

export const LEGAL: Record<LegalDoc, Record<Locale, LegalContent>> = {
  privacy: {
    fr: {
      title: "Politique de confidentialité",
      notice: "Texte provisoire : il doit être validé par un juriste avant la mise en production.",
      updated: "Dernière mise à jour : novembre 2026",
      sections: [
        { title: "Qui sommes-nous", body: ["{company} (« nous ») exploite ce site de vente de tissus en gros. Vous pouvez nous écrire à {email} pour toute question sur vos données."] },
        { title: "Données que nous collectons", body: [
          "Compte : nom, société, e-mail, téléphone, adresses de facturation et de livraison, langue préférée.",
          "Activité commerciale : devis, réservations, demandes d'échantillons, commandes et livraisons.",
          "Messages : le contenu des formulaires de contact et les descriptions de projet saisies dans l'assistant de recherche de tissus.",
          "Techniques : cookies strictement nécessaires (connexion, langue, jeton anonyme de recherche). Nous mesurons l'audience sans cookie.",
        ] },
        { title: "Pourquoi nous les utilisons", body: ["Fournir votre compte, établir des devis, préparer et livrer vos commandes, répondre à vos messages, améliorer la recherche de tissus et sécuriser le site."] },
        { title: "Intelligence artificielle", body: ["Pour recommander des tissus, le texte de votre description est envoyé à nos prestataires d'IA (génération de texte et recherche sémantique). Il n'est pas utilisé pour entraîner leurs modèles."] },
        { title: "Prestataires", body: ["Hébergement du site et de la base de données, envoi d'e-mails et services d'IA. Ils traitent les données uniquement pour notre compte."] },
        { title: "Durées de conservation", body: [
          "Recherches anonymes : 90 jours. Photos envoyées pour la recherche : 30 jours. Messages de contact : 2 ans.",
          "Devis et commandes : 10 ans (obligations comptables). Votre compte est conservé tant qu'il est actif.",
        ] },
        { title: "Vos droits", body: ["Vous pouvez accéder à vos données, les corriger, demander leur suppression (bouton dans votre profil) ou leur export. Écrivez-nous à {email}."] },
      ],
    },
    en: {
      title: "Privacy policy",
      notice: "Provisional text: it must be reviewed by a lawyer before the site goes live.",
      updated: "Last updated: November 2026",
      sections: [
        { title: "Who we are", body: ["{company} (“we”) runs this wholesale fabric website. You can write to us at {email} with any question about your data."] },
        { title: "Data we collect", body: [
          "Account: name, company, email, phone, billing and shipping addresses, preferred language.",
          "Commercial activity: quotes, reservations, sample requests, orders and deliveries.",
          "Messages: the content of contact forms and the project descriptions you type into the fabric-matching assistant.",
          "Technical: strictly necessary cookies (sign-in, language, anonymous matching token). We measure audience without cookies.",
        ] },
        { title: "Why we use it", body: ["To provide your account, prepare quotes, process and deliver orders, answer your messages, improve fabric matching and keep the site secure."] },
        { title: "Artificial intelligence", body: ["To recommend fabrics, the text of your description is sent to our AI providers (text generation and semantic search). It is not used to train their models."] },
        { title: "Service providers", body: ["Hosting of the site and database, email delivery and AI services. They process data only on our behalf."] },
        { title: "Retention", body: [
          "Anonymous searches: 90 days. Photos uploaded for matching: 30 days. Contact messages: 2 years.",
          "Quotes and orders: 10 years (accounting obligations). Your account is kept while it is active.",
        ] },
        { title: "Your rights", body: ["You can access and correct your data, request deletion (button in your profile) or an export. Write to us at {email}."] },
      ],
    },
    ar: {
      title: "سياسة الخصوصية",
      notice: "نص مؤقت: يجب أن يراجعه مستشار قانوني قبل إطلاق الموقع.",
      updated: "آخر تحديث: نوفمبر 2026",
      sections: [
        { title: "من نحن", body: ["تدير {company} («نحن») هذا الموقع لبيع الأقمشة بالجملة. يمكنك مراسلتنا على {email} لأي سؤال حول بياناتك."] },
        { title: "البيانات التي نجمعها", body: [
          "الحساب: الاسم والشركة والبريد الإلكتروني والهاتف وعناوين الفوترة والتسليم واللغة المفضلة.",
          "النشاط التجاري: عروض الأسعار والحجوزات وطلبات العينات والطلبات والتسليمات.",
          "الرسائل: محتوى نماذج الاتصال ووصف مشروعك الذي تكتبه في مساعد مطابقة الأقمشة.",
          "تقنية: ملفات تعريف الارتباط الضرورية فقط (تسجيل الدخول واللغة ورمز البحث المجهول). نقيس عدد الزوار دون ملفات تعريف ارتباط.",
        ] },
        { title: "لماذا نستخدمها", body: ["لتوفير حسابك وإعداد عروض الأسعار ومعالجة الطلبات وتسليمها والرد على رسائلك وتحسين مطابقة الأقمشة وتأمين الموقع."] },
        { title: "الذكاء الاصطناعي", body: ["لاقتراح الأقمشة يُرسل نص وصفك إلى مزودي الذكاء الاصطناعي لدينا (توليد النصوص والبحث الدلالي). ولا يُستخدم لتدريب نماذجهم."] },
        { title: "مزودو الخدمات", body: ["استضافة الموقع وقاعدة البيانات وإرسال البريد الإلكتروني وخدمات الذكاء الاصطناعي. وهم يعالجون البيانات لحسابنا فقط."] },
        { title: "مدة الاحتفاظ", body: [
          "عمليات البحث المجهولة: 90 يومًا. الصور المرفوعة للمطابقة: 30 يومًا. رسائل الاتصال: سنتان.",
          "عروض الأسعار والطلبات: 10 سنوات (التزامات محاسبية). يُحتفظ بحسابك ما دام نشطًا.",
        ] },
        { title: "حقوقك", body: ["يمكنك الاطلاع على بياناتك وتصحيحها وطلب حذفها (زر في ملفك الشخصي) أو تصديرها. راسلنا على {email}."] },
      ],
    },
  },
  terms: {
    fr: {
      title: "Conditions d'utilisation",
      notice: "Texte provisoire : il doit être validé par un juriste avant la mise en production.",
      updated: "Dernière mise à jour : novembre 2026",
      sections: [
        { title: "Objet", body: ["Ces conditions encadrent l'utilisation du site de {company}, destiné aux professionnels achetant des tissus en gros."] },
        { title: "Compte", body: ["Vous êtes responsable de l'exactitude des informations de votre compte et de la confidentialité de votre mot de passe."] },
        { title: "Recommandations de tissus", body: ["Les propositions de l'assistant sont indicatives. Vérifiez les caractéristiques techniques et demandez un échantillon avant toute commande importante."] },
        { title: "Devis et commandes", body: [
          "Un devis est valable pendant la durée indiquée. Une commande n'est ferme qu'une fois votre devis accepté et la commande confirmée par {company}.",
          "Les prix sont indiqués hors taxes lorsque la TVA est détaillée sur le devis. Les quantités restent soumises à la disponibilité du stock.",
        ] },
        { title: "Réservations et échantillons", body: ["Une réservation de stock est limitée à 48 heures. Le nombre de réservations et de demandes d'échantillons par client peut être limité."] },
        { title: "Propriété intellectuelle", body: ["Les contenus du site (textes, images, logo) appartiennent à {company} ou à ses partenaires et ne peuvent être réutilisés sans autorisation."] },
        { title: "Responsabilité et droit applicable", body: ["Nous nous efforçons d'assurer la disponibilité du site sans la garantir. Le droit applicable et le tribunal compétent seront précisés avant la mise en production."] },
        { title: "Contact", body: ["Pour toute question : {email}."] },
      ],
    },
    en: {
      title: "Terms of use",
      notice: "Provisional text: it must be reviewed by a lawyer before the site goes live.",
      updated: "Last updated: November 2026",
      sections: [
        { title: "Purpose", body: ["These terms govern the use of the {company} website, intended for professionals buying fabrics wholesale."] },
        { title: "Account", body: ["You are responsible for the accuracy of your account information and for keeping your password confidential."] },
        { title: "Fabric recommendations", body: ["The assistant's suggestions are indicative. Check the technical specifications and request a sample before any large order."] },
        { title: "Quotes and orders", body: [
          "A quote is valid for the period shown. An order is firm only once your quote is accepted and the order is confirmed by {company}.",
          "Prices are shown excluding tax where VAT is itemized on the quote. Quantities remain subject to stock availability.",
        ] },
        { title: "Reservations and samples", body: ["A stock reservation is limited to 48 hours. The number of reservations and sample requests per customer may be limited."] },
        { title: "Intellectual property", body: ["Site content (texts, images, logo) belongs to {company} or its partners and may not be reused without permission."] },
        { title: "Liability and governing law", body: ["We work to keep the site available but do not guarantee it. The governing law and competent court will be specified before launch."] },
        { title: "Contact", body: ["For any question: {email}."] },
      ],
    },
    ar: {
      title: "شروط الاستخدام",
      notice: "نص مؤقت: يجب أن يراجعه مستشار قانوني قبل إطلاق الموقع.",
      updated: "آخر تحديث: نوفمبر 2026",
      sections: [
        { title: "الغرض", body: ["تنظّم هذه الشروط استخدام موقع {company}، المخصص للمهنيين الذين يشترون الأقمشة بالجملة."] },
        { title: "الحساب", body: ["أنت مسؤول عن صحة معلومات حسابك وعن سرية كلمة المرور."] },
        { title: "اقتراحات الأقمشة", body: ["اقتراحات المساعد استرشادية. تحقق من المواصفات التقنية واطلب عينة قبل أي طلب كبير."] },
        { title: "عروض الأسعار والطلبات", body: [
          "عرض السعر صالح للمدة المذكورة. لا يصبح الطلب نهائيًا إلا بعد قبول عرض السعر وتأكيد الطلب من {company}.",
          "تُعرض الأسعار دون ضريبة عندما تُفصَّل ضريبة القيمة المضافة في عرض السعر. وتبقى الكميات رهن توفر المخزون.",
        ] },
        { title: "الحجوزات والعينات", body: ["حجز المخزون محدود بـ 48 ساعة. وقد يُحدَّد عدد الحجوزات وطلبات العينات لكل عميل."] },
        { title: "الملكية الفكرية", body: ["محتوى الموقع (النصوص والصور والشعار) ملك لـ {company} أو لشركائها ولا يجوز إعادة استخدامه دون إذن."] },
        { title: "المسؤولية والقانون المطبق", body: ["نعمل على إبقاء الموقع متاحًا دون ضمان ذلك. سيُحدَّد القانون المطبق والمحكمة المختصة قبل الإطلاق."] },
        { title: "التواصل", body: ["لأي سؤال: {email}."] },
      ],
    },
  },
};

export function fillLegal(text: string, vars: { company: string; email: string }): string {
  return text.replaceAll("{company}", vars.company).replaceAll("{email}", vars.email);
}
