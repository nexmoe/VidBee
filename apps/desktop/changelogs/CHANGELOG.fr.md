# Journal des modifications de VidBee

Cette page ne présente que les évolutions visibles par les utilisateurs, sans détails techniques.
Pour les notes de version complètes, consultez [GitHub Releases](https://github.com/nexmoe/VidBee/releases).

## [Unreleased]

## [v2.3.0](https://github.com/nexmoe/VidBee/releases/tag/v2.3.0) - 2026-10-25

### Améliorations
- Les nouvelles installations activent par défaut le lancement à l’ouverture de session et masquent l’icône du Dock sur macOS ; ces deux options restent modifiables dans les réglages.
- Les images de partage des transcriptions et des réponses IA sont plus compactes grâce à un texte légèrement réduit.

## [v2.2.4](https://github.com/nexmoe/VidBee/releases/tag/v2.2.4) - 2026-10-24

### Nouveautés
- Connectez des assistants IA externes à VidBee pour gérer les téléchargements, abonnements, transcriptions et exports.
- Poursuivez la même conversation Agent dans VidBee Desktop et dans l’extension du navigateur.
- Téléchargez uniquement les sous-titres, sans télécharger la vidéo.
- Enregistrez les diagrammes IA en JPG, en plus des formats SVG, PNG et du texte source Mermaid.

### Améliorations
- Les grandes bibliothèques de téléchargements et de transcriptions restent réactives ; les fichiers convertis sont plus faciles à retrouver.
- Les titres et les couvertures apparaissent dès l’ajout à la file de téléchargement.
- Chaque profil de navigateur conserve sa propre session de connexion lorsque l’extension utilise Desktop.
- Les diagrammes IA et leurs commandes sont plus cohérents dans les thèmes clair et sombre.
- Les téléchargements peuvent à nouveau démarrer dans les versions pour Mac Intel qui ne contenaient pas tous les outils nécessaires.

## [v2.2.3](https://github.com/nexmoe/VidBee/releases/tag/v2.2.3) - 2026-10-11

### Améliorations
- Les modèles d’un même fournisseur IA restent groupés lorsque vous modifiez ou supprimez ce fournisseur.
- Les réponses illustrées d’Agent n’ajoutent plus de captures d’écran inutilisées à la fin.

## [v2.2.2](https://github.com/nexmoe/VidBee/releases/tag/v2.2.2) - 2026-10-11

### Améliorations
- Les conversations Agent et les demandes portant sur une transcription fonctionnent à nouveau dans l’application installée, sans échouer dès le démarrage.

## [v2.2.1](https://github.com/nexmoe/VidBee/releases/tag/v2.2.1) - 2026-10-11

### Améliorations
- Les réglages du compte sont de nouveau accessibles dans la version publiée de l’application de bureau.

## [v2.2.0](https://github.com/nexmoe/VidBee/releases/tag/v2.2.0) - 2026-10-11

### Nouveautés
- Choisissez FireRedASR v2 pour le chinois, l’anglais et les dialectes chinois, ou le modèle Qwen3-ASR 1.7B, plus volumineux, pour la transcription locale.
- Choisissez Orukeet pour la transcription locale. (by @Nathan-Roll1, [#480](https://github.com/nexmoe/VidBee/pull/480))
- Connectez-vous à votre compte VidBee et utilisez les modèles Cloud dans les conversations avec Agent.
- Demandez à Agent de gérer les téléchargements et les abonnements, de transcrire des fichiers, ou de convertir et découper des médias.

### Améliorations
- Choisissez le format de conteneur vidéo pour télécharger une liste de lecture. (by @jabrailkhalil, [#469](https://github.com/nexmoe/VidBee/pull/469))
- Conservez les vidéos WebM même si la pochette ne peut pas être intégrée, ainsi que les fichiers de sous-titres des téléchargements par abonnement. ([#487](https://github.com/nexmoe/VidBee/pull/487), [#484](https://github.com/nexmoe/VidBee/pull/484))
- Le compte se rafraîchit moins souvent et les informations sur les modèles Cloud disponibles sont réutilisées entre les conversations. ([#495](https://github.com/nexmoe/VidBee/pull/495))
- Les titres modifiés pendant une réponse d’Agent sont enregistrés ; le chronomètre s’arrête pendant une demande de confirmation et la capacité Cloud est libérée à l’arrêt de la réponse. ([#495](https://github.com/nexmoe/VidBee/pull/495))
- Une confirmation est demandée avant de modifier des réglages protégés ou de supprimer du contenu, y compris dans les dossiers hors bibliothèque accessibles par un lien symbolique. ([#495](https://github.com/nexmoe/VidBee/pull/495))
- Les exports Markdown et PDF conservent les liens vidéo d’origine et les captures d’articles montrent précisément les images demandées, même déjà chargées. ([#495](https://github.com/nexmoe/VidBee/pull/495))
- La fusion ou la conversion d’un média ne provoque plus un échec du téléchargement après une minute. ([#462](https://github.com/nexmoe/VidBee/issues/462), [#488](https://github.com/nexmoe/VidBee/pull/488))
- Les sélecteurs de format des versions bureau et web conservent les vidéos HLS en haute résolution et les pistes audio de langues différentes. ([#443](https://github.com/nexmoe/VidBee/issues/443), [#488](https://github.com/nexmoe/VidBee/pull/488))
- Les vidéos RSS peuvent être ajoutées à nouveau après suppression de leur téléchargement ; leur lien peut aussi être copié depuis le menu. ([#479](https://github.com/nexmoe/VidBee/issues/479), [#485](https://github.com/nexmoe/VidBee/pull/485))
- Les fichiers Qwen3-ASR incomplets sont réparés ou signalés clairement avant la transcription. Les installations simultanées ne suppriment plus les fichiers des autres, même en cas d’annulation. ([#473](https://github.com/nexmoe/VidBee/issues/473), [#486](https://github.com/nexmoe/VidBee/pull/486))
- Reprenez les sections inachevées d’un article et capturez les images pertinentes pendant la rédaction.
- Les réponses terminées d’Agent s’arrêtent rapidement et les longs historiques de réflexion restent lisibles.
- Les images partagées et les documents exportés conservent la durée de réflexion et le pied de page VidBee.
- L’état actif d’un abonnement est conservé lors de l’enregistrement des options de téléchargement automatique.
- Les sous-titres disponibles de la plateforme sont importés avant la transcription locale.
- Le solde du compte et les crédits en attente de restitution s’affichent plus sûrement.
- Les téléchargements en double sont évités, même pour des demandes simultanées ou des fichiers déjà enregistrés sur cet ordinateur.
- Les files de transcription continuent d’avancer et conservent le temps écoulé après un rechargement.
- L’historique de raisonnement d’Agent est conservé et l’export de Markdown en PDF est amélioré.
- Les entrées de téléchargement peuvent être supprimées même si leurs fichiers ont déjà disparu.

## [v2.1.0](https://github.com/nexmoe/VidBee/releases/tag/v2.1.0) - 2026-08-30

### Nouveautés
- Modifiez les sous-titres d’une transcription : ajoutez une ligne, changez le texte, ou supprimez une ou plusieurs lignes.
- Les transcriptions apparaissent désormais dans la liste des téléchargements : vidéos et textes se gèrent au même endroit.
- Sélectionnez plusieurs téléchargements à la fois pour les supprimer.

### Améliorations
- Filtrez la liste par site, avec des icônes de plateforme pour reconnaître plus facilement la source.
- Les titres trop longs défilent pour que le nom complet reste lisible.
- Un fichier sans piste audio affiche un message clair au lieu d’échouer sans explication.

## [v2.0.2](https://github.com/nexmoe/VidBee/releases/tag/v2.0.2) - 2026-08-23

### Améliorations
- Sous Windows, l’ouverture d’une transcription terminée n’affiche plus une page blanche : la vidéo et le texte s’ouvrent et se lisent normalement. (by @Autsunset)

## [v2.0.1](https://github.com/nexmoe/VidBee/releases/tag/v2.0.1) - 2026-08-23

### Nouveautés
- Choisissez jusqu'à cinq langues de sous-titres dans les réglages, ou laissez VidBee suivre la langue de l'interface.
- Mettez en pause et reprenez un téléchargement en cours sans repartir de zéro. (by @Gani-SMA)

### Améliorations
- Si les sous-titres sont indisponibles, VidBee poursuit la vidéo au lieu de faire échouer tout le téléchargement.
- Les téléchargements annulés le restent après un redémarrage et ne disparaissent qu'une fois l'annulation enregistrée.
- Les liens de téléchargement sont mieux reconnus, avec des conseils plus clairs quand un site exige les cookies du navigateur.
- Téléchargez depuis davantage de sites sans installer d'outil supplémentaire.
- Sous Windows, la lecture vidéo et la fenêtre de l'application se rétablissent mieux après un problème graphique ou de page.
- L'icône de la zone de notification ouvre l'application plus sûrement.

## [v2.0.0](https://github.com/nexmoe/VidBee/releases/tag/v2.0.0) - 2026-08-22

En 1.x, VidBee enregistrait le fichier et s'arrêtait là. 2.0 continue : transcription sur cet ordinateur, noms des locuteurs, recherche d'une citation, puis résumé avec l'IA.

![Avant v1.x et après v2.0](https://github.com/nexmoe/VidBee/releases/download/v2.0.0/v2-before-after.webp)

![Télécharger, transcrire en local, chercher un mot, demander à l'IA](https://github.com/nexmoe/VidBee/releases/download/v2.0.0/v2-workflow-grid.webp)

### Nouveautés
- Nouveau parcours : télécharger → transcrire en local → chercher un mot-clé → demander un résumé à l'IA, dans la même application.

### Transcription locale
- Choisissez Whisper, SenseVoice, Parakeet ou Qwen3-ASR. VidBee peut recommander un modèle selon votre ordinateur et votre langue.
- La reconnaissance vocale s'exécute sur cet ordinateur et peut fonctionner hors ligne une fois le modèle téléchargé. L'audio n'est jamais envoyé à un service de transcription.
- Importez un fichier audio ou vidéo local, ou déposez-le sur Transcripts, pour le transcrire dans l'application.

### Locuteurs
- Détectez automatiquement qui parle et voyez le temps de parole sous le lecteur.
- Fixez le nombre de locuteurs et relabellisez la conversation sans changer les mots reconnus.
- Cliquez sur un locuteur pour aller à sa prochaine réplique.

### Recherche et horodatage
- Cherchez un mot prononcé ou le nom d'un locuteur. Les correspondances sont surlignées.
- Chaque ligne a un horodatage. Cliquez une ligne (ou un mot) pour lire à cet instant.
- Copiez un passage, ou exportez en texte, Markdown ou sous-titres.

### Ask AI
- Invites intégrées : résumé à puces, traduction, FAQ, carte mentale, correction grammaticale, et plus. Vous pouvez aussi écrire les vôtres.
- Connectez OpenAI, Anthropic, Google, DeepSeek, xAI, Ollama, LM Studio, ou un autre fournisseur. Les clés API restent sur cet ordinateur.

### Confidentialité
- Confidentialité d'abord : la voix et les fichiers restent sur cet ordinateur.
- Si vous lancez Ask AI, seul le texte de la transcription va vers le fournisseur choisi. Utilisez Ollama ou LM Studio pour garder aussi cette étape en local.

### Aussi dans cette version
- Le mini lecteur reste disponible quand vous changez d'écran.
- Le moteur de téléchargement peut se mettre à jour en arrière-plan pour continuer à prendre en charge plus de sites.

### Améliorations
- En mode portable, un dossier de téléchargement choisi hors du répertoire portable n'est plus réinitialisé.
- La transcription fonctionne aussi sur les Mac Intel.
- Téléchargements et installations auto-hébergées plus fiables.

## [v1.3.14](https://github.com/nexmoe/VidBee/releases/tag/v1.3.14) - 2026-07-05

### Améliorations
- La prise en charge des téléchargements est actualisée pour suivre les changements récents des sites compatibles.

## [v1.3.13](https://github.com/nexmoe/VidBee/releases/tag/v1.3.13) - 2026-06-20

### Nouveautés
- Utilisez VidBee sous Windows sans installation, avec la possibilité de conserver les données et les téléchargements à côté de l’application. (by @jabrailkhalil, [#403](https://github.com/nexmoe/VidBee/pull/403))
- Consultez les journaux d’un téléchargement en cours et retrouvez-les dans l’historique.

### Améliorations
- Coller un lien de playlist ou de chaîne YouTube ouvre automatiquement les options de playlist.
- Changer de lien ne lance plus le téléchargement de la vidéo précédemment sélectionnée.
- Annuler un téléchargement sous Windows l’arrête complètement ; les cookies de Firefox sont reconnus plus sûrement.
- Un sous-titre facultatif indisponible ne bloque plus les téléchargements Twitch ; un autre format est essayé si la combinaison souhaitée est absente.
- L’application peut à nouveau démarrer après son installation avec le paquet Debian pour Linux.

## [v1.3.12](https://github.com/nexmoe/VidBee/releases/tag/v1.3.12) - 2026-06-20

### Nouveautés
- Choisissez les mises à jour stables ou de préversion dans À propos et continuez à recevoir celles du canal sélectionné.

## [v1.3.11](https://github.com/nexmoe/VidBee/releases/tag/v1.3.11) - 2026-06-19

### Nouveautés
- Choisissez MP4, MKV, WebM ou le format d’origine pour les téléchargements en un clic.
- Appuyez sur Ctrl+V ou Cmd+V pour ouvrir l’ajout de téléchargement avec le lien copié.

### Améliorations
- Les indications sont plus claires lorsqu’un téléchargement nécessite des cookies, une connexion au site ou un accès réseau fonctionnel.
- Les téléchargements longs et les grandes playlists ne font plus planter l’application.
- Certaines anciennes installations 1.3 peuvent à nouveau démarrer ; la détection des outils de téléchargement sur macOS est améliorée.
- La prise en charge des téléchargements est actualisée pour suivre les changements récents des sites compatibles.

## [v1.3.10](https://github.com/nexmoe/VidBee/releases/tag/v1.3.10) - 2026-04-11
### Ameliorations
- Telechargement en un clic active par defaut pour demarrer plus vite des la premiere utilisation.
- Titres de la liste de telechargement alignes a gauche pour une lecture plus claire.

## [v1.3.9](https://github.com/nexmoe/VidBee/releases/tag/v1.3.9) - 2026-04-11
### Ameliorations
- Emplacement FFmpeg personnalise plus simple : chemin vers l'executable ou vers le dossier qui le contient.
- Messages plus clairs lors des verifications d'abonnement quand un flux est indisponible ou en erreur.
- Statut et conseils de telechargement plus lisibles pour corriger un reglage ou reessayer.
- Noms de fichiers tres longs raccourcis automatiquement sur macOS et Linux, comme sous Windows.
- La ou c'est pris en charge, raccourci clavier pour ajouter un lien aux telechargements plus vite.

## [v1.3.8](https://github.com/nexmoe/VidBee/releases/tag/v1.3.8) - 2026-04-06
### Corrections de bugs
- Migrations de base de donnees plus robustes pour les anciennes installations.
- Des outils optionnels comme FFmpeg ne bloquent plus le demarrage lorsqu'ils sont absents ou echouent a l'initialisation.
- Les verifications d'abonnement reduisent les rapports d'erreur bruyants pour les problemes reseau ou de format de flux courants.

### Ameliorations
- Affinage des retours GlitchTip et des details de rapport d'erreurs.

## [v1.3.7](https://github.com/nexmoe/VidBee/releases/tag/v1.3.7) - 2026-03-29
### Corrections de bugs
- Amelioration de la sanitisation des noms de fichiers pour gerer les caracteres Unicode speciaux et les codes de controle.
- Les telechargements Windows tronquent desormais automatiquement les noms de fichiers trop longs.
- La modification de la limite de telechargements simultanes prend effet immediatement sans redemarrage.

## [v1.3.6](https://github.com/nexmoe/VidBee/releases/tag/v1.3.6) - 2026-03-29

### Fonctionnalités
- Intégration de GlitchTip pour les rapports d'erreurs et les retours utilisateurs
- Ajout d'une notification de mise à jour lorsque la version est obsolète
- Intégration de l'analytique Rybbit
- Amélioration des détails de l'interface de téléchargement

## [v1.3.5](https://github.com/nexmoe/VidBee/releases/tag/v1.3.5) - 2026-03-18

### Améliorations
- La prise en charge des téléchargements est actualisée pour suivre les changements récents des sites compatibles.

## [v1.3.4](https://github.com/nexmoe/VidBee/releases/tag/v1.3.4) - 2026-03-14
### Corrections de bugs
- Utilisation de la source Electron par defaut pendant le packaging afin d'ameliorer la fiabilite des builds macOS de release.

## [v1.3.3](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3) - 2026-03-14
### Mises a jour de fonctionnalites
- Amelioration du flux de publication afin de diffuser les builds preview separement des notifications de mise a jour en production.

### Corrections de bugs
- Reactivation de npm rebuild pendant le packaging Electron afin de preparer plus fiablement les dependances natives dans les builds de release.
- Amelioration du bundling desktop pour inclure plus regulierement les dependances partagees du workspace dans les versions publiees.

## [v1.3.3-preview.1](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3-preview.1) - 2026-03-14
### Corrections de bugs
- Reactivation de npm rebuild pendant le packaging Electron pour preparer plus fiablement les dependances natives dans les builds de release.

## [v1.3.3-preview.0](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3-preview.0) - 2026-03-14
### Mises a jour de fonctionnalites
- Ajout d'un canal de publication preview pour diffuser les builds de test sans declencher les mises a jour du site de production.

### Corrections de bugs
- Amelioration du bundling desktop afin d'inclure plus regulierement les dependances partagees du workspace dans les builds publies.

## [v1.3.2](https://github.com/nexmoe/VidBee/releases/tag/v1.3.2) - 2026-03-14
### Corrections de bugs
- Amelioration de la fiabilite du packaging desktop afin d'inclure plus regulierement les composants de telechargement partages.

## [v1.3.1](https://github.com/nexmoe/VidBee/releases/tag/v1.3.1) - 2026-03-14
### Mises a jour de fonctionnalites
- Ajout des editions Web et API, avec des capacites de telechargement partagees et un comportement des reglages harmonise.
- Ajout de la prise en charge de l'envoi de fichiers Cookie et de configuration depuis les reglages.
- Migration de l'historique des telechargements vers SQLite pour une meilleure fiabilite et une meilleure coherence multi-plateforme.
- Ajout d'un flux partage pour l'ajout d'URL dans les boites de dialogue de telechargement et amelioration de la visibilite du curseur en theme sombre.

### Corrections de bugs
- Amelioration de la robustesse et des diagnostics du processus d'initialisation des binaires embarques sur desktop.
- Correction du saut de curseur dans le champ de profil des reglages.
- Correction de la validation du dossier de telechargement sous Linux lors de la selection d'un dossier existant non vide.
- Amelioration de la coherence des localisations, y compris des corrections de traduction chinoise.

## [v1.3.0](https://github.com/nexmoe/VidBee/releases/tag/v1.3.0) - 2026-02-15
### Mises a jour de fonctionnalites
- Ajout de nouvelles actions en un clic pour coller un lien et lancer le téléchargement plus vite.
- Ajout de la prise en charge des langues française, russe et turque dans l'application.
- Le format de conteneur sélectionné est désormais respecté de manière plus cohérente.

### Corrections de bugs
- Amélioration de la compatibilité des téléchargements pour YouTube et les scénarios de repli de format.
- Les réglages et la documentation ont été améliorés, avec des indications plus claires pour les rapports de bug et le RSS.

## [v1.2.4](https://github.com/nexmoe/VidBee/releases/tag/v1.2.4) - 2026-01-24
### Mises a jour de fonctionnalites
- Le flux de téléchargement en un clic est plus direct et demande moins d'étapes.
- Un onglet Cookie dédié a été ajouté dans les réglages pour simplifier les actions liées au compte.
- Les points d'entrée FAQ sont plus clairs et les messages d'erreur sont plus faciles à comprendre.

### Corrections de bugs
- Les indications RSS sont plus claires, surtout pour les nouveaux utilisateurs.

## [v1.2.3](https://github.com/nexmoe/VidBee/releases/tag/v1.2.3) - 2026-01-23
### Mises a jour de fonctionnalites
- Le chargement des playlists est plus stable et ne compresse plus l'interface.
- Le guide d'utilisation des cookies inclut désormais des exemples plus clairs.

## [v1.2.2](https://github.com/nexmoe/VidBee/releases/tag/v1.2.2) - 2026-01-21
### Mises a jour de fonctionnalites
- Les actions liées au téléchargement sont plus faciles à trouver.
- Ajout d'une option pour inclure ou retirer le filigrane lors du partage.
- Les interactions de téléchargement sont plus cohérentes dans l'ensemble.

## [v1.2.1](https://github.com/nexmoe/VidBee/releases/tag/v1.2.1) - 2026-01-20
### Mises a jour de fonctionnalites
- Les éléments avec le même titre dans les playlists sont plus faciles à distinguer.
- Il est plus simple de trouver les journaux et les fichiers liés lors du dépannage.

### Corrections de bugs
- Les notifications de téléchargement sont moins intrusives.
- Les liens et indications des abonnements sont plus fiables.

## [v1.2.0](https://github.com/nexmoe/VidBee/releases/tag/v1.2.0) - 2026-01-17
### Mises a jour de fonctionnalites
- Ajout d'actions rapides pour tout sélectionner et vider l'historique des téléchargements.
- Le comportement lors de la réduction et de la réouverture est plus fluide.
- Les doublons dans les abonnements sont réduits.
- Les pages Playlist et Réglages sont plus simples à utiliser.

### Corrections de bugs
- La reprise après une interruption de téléchargement est plus fiable.

## [v1.1.12](https://github.com/nexmoe/VidBee/releases/tag/v1.1.12) - 2026-01-15
### Mises a jour de fonctionnalites
- Le comportement du dossier de téléchargement dans les réglages est plus prévisible.

### Corrections de bugs
- Les rapports de retour contiennent désormais des informations d'appui plus claires.

## [v1.1.11](https://github.com/nexmoe/VidBee/releases/tag/v1.1.11) - 2026-01-14
### Mises a jour de fonctionnalites
- Les flux de téléchargement et la mise en page sont plus clairs.
- La navigation des abonnements est plus fluide.
- Les réglages par défaut sont plus adaptés à un usage quotidien.

### Corrections de bugs
- Les messages d'erreur proposent des étapes suivantes plus claires.

## [v1.1.10](https://github.com/nexmoe/VidBee/releases/tag/v1.1.10) - 2026-01-12
### Mises a jour de fonctionnalites
- L'installation et la mise à jour sur macOS sont plus stables.

## [v1.1.8](https://github.com/nexmoe/VidBee/releases/tag/v1.1.8) - 2026-01-12
### Mises a jour de fonctionnalites
- Les détails de progression des téléchargements sont plus lisibles.

### Corrections de bugs
- Les notifications de mise à jour localisées sont plus claires.

## [v1.1.7](https://github.com/nexmoe/VidBee/releases/tag/v1.1.7) - 2026-01-11
### Mises a jour de fonctionnalites
- Davantage d'options de préférences de sortie média ont été ajoutées.
- La configuration initiale et l'utilisation quotidienne sont plus fluides.

## [v1.1.6](https://github.com/nexmoe/VidBee/releases/tag/v1.1.6) - 2026-01-11
### Mises a jour de fonctionnalites
- Les flux liés aux informations vidéo locales sont plus faciles à utiliser.
- La gestion des profils de cookies est plus stable et plus prévisible.

## [v1.1.5](https://github.com/nexmoe/VidBee/releases/tag/v1.1.5) - 2026-01-10
### Mises a jour de fonctionnalites
- Correction de problèmes connus dans les réglages avancés.

### Corrections de bugs
- Amélioration de la stabilité du chargement des couvertures distantes.
- La sélection des couvertures d'abonnement est plus fiable.

## [v1.1.4](https://github.com/nexmoe/VidBee/releases/tag/v1.1.4) - 2026-01-09
### Mises a jour de fonctionnalites
- Le comportement de la fenêtre au démarrage est plus naturel.
- Le comportement global des réglages est plus cohérent.

## [v1.1.3](https://github.com/nexmoe/VidBee/releases/tag/v1.1.3) - 2026-01-02
### Mises a jour de fonctionnalites
- Le statut de mise à jour est plus visible sur la page About.

### Corrections de bugs
- La sélection de format est plus fiable selon les scénarios.

## [v1.1.2](https://github.com/nexmoe/VidBee/releases/tag/v1.1.2) - 2025-12-26
### Mises a jour de fonctionnalites
- La disponibilité du téléchargement a été rétablie pour davantage de sites.
- Le flux de signalement des problèmes est plus simple.

## [v1.1.1](https://github.com/nexmoe/VidBee/releases/tag/v1.1.1) - 2025-12-26
### Mises a jour de fonctionnalites
- Les notifications de mise à jour sont moins perturbantes.
- Les textes et liens de la page About sont plus clairs.
- Les interactions du panneau de téléchargement sont plus fluides.

## [v1.1.0](https://github.com/nexmoe/VidBee/releases/tag/v1.1.0) - 2025-12-20
### Mises a jour de fonctionnalites
- Ajout d'actions groupées pour nettoyer l'historique des téléchargements.
- L'ouverture des liens de tâche de téléchargement est plus prévisible.
- Ajout de la prise en charge des dossiers de téléchargement personnalisés.
- La boîte de dialogue de configuration RSS est plus simple à comprendre et à remplir.

## [v1.0.2](https://github.com/nexmoe/VidBee/releases/tag/v1.0.2) - 2025-12-06
### Mises a jour de fonctionnalites
- La saisie des chemins est plus tolérante au quotidien.

### Corrections de bugs
- Ajout de plus d'options de compatibilité pour davantage de scénarios d'usage.

## [v1.0.1](https://github.com/nexmoe/VidBee/releases/tag/v1.0.1) - 2025-11-16
### Mises a jour de fonctionnalites
- Ajout de la prise en charge du lancement automatique.
- La prise en charge des langues a été encore élargie.

## [v1.0.0](https://github.com/nexmoe/VidBee/releases/tag/v1.0.0) - 2025-11-15
### Mises a jour de fonctionnalites
- Première version majeure stable de VidBee.
- Ajout des téléchargements via abonnements RSS.
- La navigation et le flux général de l'interface sont plus clairs.
- L'historique et l'aperçu des médias ont été améliorés.

## [v0.3.5](https://github.com/nexmoe/VidBee/releases/tag/v0.3.5) - 2025-11-08
### Mises a jour de fonctionnalites
- Les textes et messages du téléchargement en un clic sont plus faciles à comprendre.
- Le style visuel est plus cohérent.

## [v0.3.4](https://github.com/nexmoe/VidBee/releases/tag/v0.3.4) - 2025-11-03
### Mises a jour de fonctionnalites
- Les messages de mise à jour et l'affichage des options de téléchargement sont plus clairs.

## [v0.3.3](https://github.com/nexmoe/VidBee/releases/tag/v0.3.3) - 2025-11-02
### Corrections de bugs
- La stabilité du traitement des téléchargements a été améliorée dans davantage de scénarios.

## [v0.3.2](https://github.com/nexmoe/VidBee/releases/tag/v0.3.2) - 2025-10-31
### Mises a jour de fonctionnalites
- L'expérience de distribution multi-appareils a été améliorée.

## [v0.3.1](https://github.com/nexmoe/VidBee/releases/tag/v0.3.1) - 2025-10-30
### Mises a jour de fonctionnalites
- L'expérience Linux est plus conviviale.
- Ajout de notifications de nouvelles versions pour des mises à niveau plus rapides.

## [v0.3.0](https://github.com/nexmoe/VidBee/releases/tag/v0.3.0) - 2025-10-29
### Mises a jour de fonctionnalites
- Ajout de la prise en charge du téléchargement de playlists.
- Ajout de contrôles pour réduire les perturbations sur le bureau.

## [v0.2.2](https://github.com/nexmoe/VidBee/releases/tag/v0.2.2) - 2025-10-27
### Mises a jour de fonctionnalites
- Poursuite du peaufinage UX pendant la phase de préversion.

## [v0.2.1](https://github.com/nexmoe/VidBee/releases/tag/v0.2.1) - 2025-10-26
### Mises a jour de fonctionnalites
- Poursuite du peaufinage UX pendant la phase de préversion.

## [v0.2.0](https://github.com/nexmoe/VidBee/releases/tag/v0.2.0) - 2025-10-25
### Mises a jour de fonctionnalites
- Poursuite du peaufinage UX pendant la phase de préversion.

## [v0.1.8](https://github.com/nexmoe/VidBee/releases/tag/v0.1.8) - 2025-10-24
### Mises a jour de fonctionnalites
- Le programme de préversion publique a démarré.

## [v0.1.7](https://github.com/nexmoe/VidBee/releases/tag/v0.1.7) - 2025-10-24
### Mises a jour de fonctionnalites
- Ajout de la prise en charge de la mise a jour automatique et amélioration des consignes de publication dans la documentation.
- Amélioration de la documentation du projet, y compris les captures d'écran et le guide de contribution.

### Corrections de bugs
- Simplification de la gestion des chemins de téléchargement et suppression de la logique de chemin de sortie inutilisée.

## [v0.1.6](https://github.com/nexmoe/VidBee/releases/tag/v0.1.6) - 2025-10-23
### Corrections de bugs
- Suppression d'une étape inutile de création de dossier dans le workflow de publication.

## [v0.1.5](https://github.com/nexmoe/VidBee/releases/tag/v0.1.5) - 2025-10-23
### Corrections de bugs
- Amélioration du workflow de publication pour télécharger les binaires yt-dlp lors du packaging multiplateforme.

## [v0.1.4](https://github.com/nexmoe/VidBee/releases/tag/v0.1.4) - 2025-10-23
### Corrections de bugs
- Mise à jour du workflow de publication pour cibler uniquement les builds Windows.

## [v0.1.3](https://github.com/nexmoe/VidBee/releases/tag/v0.1.3) - 2025-10-23
### Corrections de bugs
- Simplification des étapes de build de publication et de la gestion des artefacts dans CI.
- Ajustement des déclencheurs CI: l'automatisation des pull requests ne s'exécute que pour `main`.

## [v0.1.2](https://github.com/nexmoe/VidBee/releases/tag/v0.1.2) - 2025-10-23
### Corrections de bugs
- Définition explicite du shell pour l'étape de build dans le workflow de publication.

## [v0.1.1](https://github.com/nexmoe/VidBee/releases/tag/v0.1.1) - 2025-10-23
### Mises a jour de fonctionnalites
- Itération de release précoce sans changement utilisateur supplémentaire documenté.

## [v0.1.0](https://github.com/nexmoe/VidBee/releases/tag/v0.1.0) - 2025-10-23
### Mises a jour de fonctionnalites
- Point de départ de la première release publique.
