plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.22"
    id("org.jetbrains.intellij") version "1.17.2"
}

group = "com.nexterm"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.github.mwiede:jsch:0.2.18")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    implementation("com.google.code.gson:gson:2.10.1")
    testImplementation(kotlin("test"))
}

intellij {
    version.set("2023.3")
    type.set("IU") // IntelliJ IDEA Ultimate — also works for WebStorm
    plugins.set(listOf("terminal"))
}

tasks {
    buildSearchableOptions {
        enabled = false
    }
    patchPluginXml {
        sinceBuild.set("233")
        untilBuild.set("253.*")
    }
    compileKotlin {
        kotlinOptions.jvmTarget = "17"
    }
}
